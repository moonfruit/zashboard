<template>
  <div class="relative flex h-full min-h-0 flex-col">
    <CtrlsBar>
      <div class="flex items-center gap-2 p-2">
        <SegmentedControl
          v-model="activeTab"
          :options="tabOptions"
        />
      </div>
    </CtrlsBar>

    <div
      class="min-h-0 flex-1 overflow-y-auto"
      :style="padding"
    >
      <div class="mx-auto flex max-w-5xl flex-col gap-3 p-3">
        <KeepAlive>
          <NetworkToolsPanel v-if="currentTab === 'network'" />
          <TailscalePanel
            v-else-if="currentTab === 'tailscale'"
            :endpoints="availability.tailscale.value"
            :error="availability.tailscaleError.value"
          />
          <OpenVPNPanel
            v-else-if="currentTab === 'openvpn'"
            :endpoints="availability.openvpn.value"
            :error="availability.openvpnError.value"
          />
          <OpenConnectPanel
            v-else-if="currentTab === 'openconnect'"
            :endpoints="availability.openconnect.value"
            :error="availability.openconnectError.value"
          />
          <EbpfPanel
            v-else-if="currentTab === 'ebpf'"
            :diagnostics="availability.ebpf.value"
            :error="availability.ebpfError.value"
            :loading="availability.ebpfLoading.value"
            @refresh="availability.refreshEbpf"
          />
        </KeepAlive>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useToolsAvailability } from '@/assembly/singbox/tools/availability'
import { challengeBadge, resolveActiveTab, type ToolsTab } from '@/assembly/singbox/tools/tabs'
import CtrlsBar from '@/components/common/CtrlsBar.vue'
import SegmentedControl, { type SegmentOption } from '@/components/common/SegmentedControl.vue'
import EbpfPanel from '@/components/singbox/tools/EbpfPanel.vue'
import NetworkToolsPanel from '@/components/singbox/tools/NetworkToolsPanel.vue'
import OpenConnectPanel from '@/components/singbox/tools/OpenConnectPanel.vue'
import OpenVPNPanel from '@/components/singbox/tools/OpenVPNPanel.vue'
import TailscalePanel from '@/components/singbox/tools/TailscalePanel.vue'
import { usePaddingForViews } from '@/composables/use-padding-for-views'
import { useStorage } from '@/composables/use-storage'
import { isMiddleScreen } from '@/helper/utils'
import {
  CpuChipIcon,
  LinkIcon,
  ShareIcon,
  ShieldCheckIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/vue/24/outline'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const availability = useToolsAvailability()
const storedTab = useStorage<string>('config/singbox-tools-tab', 'network')

const currentTab = computed<ToolsTab>(() =>
  resolveActiveTab(storedTab.value, availability.tabs.value),
)

const activeTab = computed({
  get: () => currentTab.value,
  set: (value: string) => {
    storedTab.value = value
  },
})

const TAB_META: Record<ToolsTab, { label: string; icon: SegmentOption['icon'] }> = {
  network: { label: 'toolsNetwork', icon: WrenchScrewdriverIcon },
  tailscale: { label: 'tailscale', icon: ShareIcon },
  openvpn: { label: 'openvpn', icon: ShieldCheckIcon },
  openconnect: { label: 'openconnect', icon: LinkIcon },
  ebpf: { label: 'ebpfDiagnostics', icon: CpuChipIcon },
}

const tabCount = (tab: ToolsTab) => {
  if (tab === 'openvpn') return challengeBadge(availability.openvpn.value)
  if (tab === 'openconnect') return challengeBadge(availability.openconnect.value)
  return undefined
}

const tabOptions = computed<SegmentOption[]>(() => {
  const iconOnly = isMiddleScreen.value && availability.tabs.value.length > 3
  return availability.tabs.value.map((tab) => ({
    value: tab,
    label: iconOnly ? undefined : t(TAB_META[tab].label),
    ariaLabel: iconOnly ? t(TAB_META[tab].label) : undefined,
    icon: TAB_META[tab].icon,
    count: tabCount(tab),
  }))
})

const { padding } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 8,
})
</script>
