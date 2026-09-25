import { can } from '@/assembly/backend'
import { activeUuid } from '@/store/setup'
import { computed, ref, shallowRef, watch, watchEffect } from 'vue'
import type { SharedStream } from '../api/stream'
import { toolErrorMessage } from './common'
import { fetchEbpfDiagnostics, type EbpfDiagnostics } from './ebpf'
import { visibleTabs } from './tabs'
import { tailscaleStream, toTailscaleEndpoints } from './tailscale'
import { openConnectStream, openVPNStream, toOpenConnectEndpoints, toOpenVPNEndpoints } from './vpn'

const follow = <M, V>(
  enabled: () => boolean,
  stream: SharedStream<M>,
  map: (message: M) => V[],
) => {
  const data = shallowRef<V[]>([])
  const seen = ref(false)

  watchEffect((onCleanup) => {
    data.value = []
    seen.value = false
    if (!activeUuid.value || !enabled()) return

    const off = stream.subscribe((message) => {
      data.value = map(message)
      if (data.value.length > 0) seen.value = true
    })

    onCleanup(off)
  })

  const error = computed(() =>
    stream.phase.value !== 'active' && stream.error.value
      ? toolErrorMessage(stream.error.value)
      : '',
  )

  return { data, seen, error }
}

export const createEbpfRefresh = (fetch: () => Promise<EbpfDiagnostics>) => {
  const ebpf = shallowRef<EbpfDiagnostics>()
  const ebpfError = ref('')
  const ebpfLoading = ref(false)
  let generation = 0

  const refresh = async (enabled: boolean, { reset }: { reset: boolean }) => {
    const current = ++generation
    if (reset || !enabled) {
      ebpf.value = undefined
      ebpfError.value = ''
    }

    if (!enabled) {
      ebpfLoading.value = false
      return
    }

    ebpfLoading.value = true
    try {
      const result = await fetch()
      if (current === generation) {
        ebpf.value = result
        ebpfError.value = ''
      }
    } catch (e) {
      if (current === generation) ebpfError.value = toolErrorMessage(e)
    } finally {
      if (current === generation) ebpfLoading.value = false
    }
  }

  return { ebpf, ebpfError, ebpfLoading, refresh }
}

export const useToolsAvailability = () => {
  const tailscale = follow(() => can('tailscale'), tailscaleStream, toTailscaleEndpoints)
  const openvpn = follow(() => can('openvpn'), openVPNStream, toOpenVPNEndpoints)
  const openconnect = follow(() => can('openconnect'), openConnectStream, toOpenConnectEndpoints)

  const ebpf = createEbpfRefresh(fetchEbpfDiagnostics)
  const refreshEbpf = () => ebpf.refresh(can('ebpfDiagnostics'), { reset: false })

  watch(
    [activeUuid, () => can('ebpfDiagnostics')],
    () => ebpf.refresh(can('ebpfDiagnostics'), { reset: true }),
    { immediate: true },
  )

  const tabs = computed(() =>
    visibleTabs({
      tailscale: can('tailscale'),
      openvpn: can('openvpn'),
      openconnect: can('openconnect'),
      ebpf: can('ebpfDiagnostics'),
      tailscaleSeen: tailscale.seen.value,
      openvpnSeen: openvpn.seen.value,
      openconnectSeen: openconnect.seen.value,
      ebpfInbounds: ebpf.ebpf.value?.inbounds.length ?? 0,
    }),
  )

  return {
    tailscale: tailscale.data,
    tailscaleError: tailscale.error,
    openvpn: openvpn.data,
    openvpnError: openvpn.error,
    openconnect: openconnect.data,
    openconnectError: openconnect.error,
    ebpf: ebpf.ebpf,
    ebpfError: ebpf.ebpfError,
    ebpfLoading: ebpf.ebpfLoading,
    refreshEbpf,
    tabs,
  }
}
