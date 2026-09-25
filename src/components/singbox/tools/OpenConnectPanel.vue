<template>
  <div class="flex flex-col">
    <div
      v-if="error"
      class="text-error text-sm"
    >
      {{ error }}
    </div>
    <div
      v-else-if="endpoints.length === 0"
      class="text-base-content/50 px-1 py-2 text-sm"
    >
      {{ $t('toolNoEndpoints') }}
    </div>
    <template
      v-for="endpoint in endpoints"
      :key="endpoint.tag"
    >
      <div class="settings-section-label flex items-center justify-between gap-2 normal-case">
        <span class="flex items-center gap-2 tracking-normal">
          <span class="text-base-content/90 text-sm font-semibold">
            {{ endpoint.tag || 'OpenConnect' }}
          </span>
          <span
            class="badge badge-sm"
            :class="statePillClass(endpoint.state)"
          >
            {{ endpoint.stateText || endpoint.state || $t('unknown') }}
          </span>
        </span>
      </div>

      <div
        v-if="endpoint.error"
        class="text-error/90 px-1 pb-1 text-xs"
      >
        {{ endpoint.error }}
      </div>

      <div
        v-if="endpoint.challenge"
        class="settings-grid p-3"
      >
        <OpenConnectAuthForm
          :key="endpoint.tag + endpoint.challenge.id"
          :endpoint-tag="endpoint.tag"
          :challenge="endpoint.challenge"
        />
      </div>

      <VpnTunnelRows
        v-if="endpoint.tunnel"
        :tunnel="endpoint.tunnel"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { OpenConnectEndpointView } from '@/assembly/singbox/tools/vpn'
import OpenConnectAuthForm from './OpenConnectAuthForm.vue'
import VpnTunnelRows from './VpnTunnelRows.vue'

defineProps<{
  endpoints: OpenConnectEndpointView[]
  error: string
}>()

const STATE_BADGE: Record<string, string> = {
  connected: 'badge-success',
  connecting: 'badge-warning',
  'auth-pending': 'badge-warning',
  error: 'badge-error',
}

const statePillClass = (state: string) => STATE_BADGE[state] ?? 'badge-ghost'
</script>
