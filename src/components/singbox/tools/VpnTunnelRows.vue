<template>
  <div class="settings-grid">
    <div
      v-for="row in rows"
      :key="row.label"
      class="setting-item"
    >
      <span class="setting-item-label shrink-0">{{ row.label }}</span>
      <span
        class="text-base-content/50 min-w-0 text-right text-sm break-all"
        :class="row.mono && 'font-mono'"
        >{{ row.value }}</span
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import type { VpnTunnelView } from '@/assembly/singbox/tools/vpn'
import { fromNow } from '@/helper/utils'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  tunnel: VpnTunnelView
}>()

const { t } = useI18n()

const rows = computed(() => {
  const list: { label: string; value: string; mono?: boolean }[] = []
  const push = (label: string, value: string, mono = false) => {
    if (value) list.push({ label, value, mono })
  }

  push(t('vpnServer'), props.tunnel.server, true)
  push(t('vpnAddresses'), props.tunnel.addresses.join(', '), true)
  push(t('vpnDns'), props.tunnel.dns.join(', '), true)
  if (props.tunnel.mtu > 0) push(t('vpnMtu'), String(props.tunnel.mtu))
  if (props.tunnel.connectedSince > 0) {
    push(t('vpnConnectedSince'), fromNow(props.tunnel.connectedSince * 1000))
  }
  for (const item of props.tunnel.extra) push(t(item.label), item.value)

  return list
})
</script>
