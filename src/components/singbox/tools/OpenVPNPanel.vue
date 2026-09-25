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
            {{ endpoint.tag || 'OpenVPN' }}
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

      <template v-if="endpoint.challenge">
        <div class="settings-grid p-3">
          <template v-if="endpoint.challenge.kind === 'open-url'">
            <p
              v-if="endpoint.challenge.message"
              class="text-base-content/70 pb-2 text-sm"
            >
              {{ endpoint.challenge.message }}
            </p>
            <div
              v-if="remaining(endpoint.challenge) !== undefined"
              class="pb-2 font-mono text-xs tabular-nums"
              :class="remaining(endpoint.challenge) === 0 ? 'text-error' : 'text-base-content/60'"
            >
              {{ $t('vpnDeadline', { seconds: remaining(endpoint.challenge) }) }}
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <a
                v-if="endpoint.challenge.url"
                :href="endpoint.challenge.url"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-primary btn-sm"
              >
                {{ $t('vpnOpenUrl') }}
              </a>
              <button
                v-if="endpoint.challenge.url"
                class="btn btn-ghost btn-sm"
                @click="openQR(endpoint.challenge.url)"
              >
                <QrCodeIcon class="h-4 w-4" />
                {{ $t('vpnShowQRCode') }}
              </button>
              <button
                class="btn btn-ghost btn-sm"
                :disabled="cancelling.has(challengeKey(endpoint.tag, endpoint.challenge.id))"
                @click="cancel(endpoint.tag, endpoint.challenge.id)"
              >
                <span
                  v-if="cancelling.has(challengeKey(endpoint.tag, endpoint.challenge.id))"
                  class="loading loading-spinner loading-xs"
                />
                {{ $t('vpnCancelChallenge') }}
              </button>
            </div>
          </template>
          <OpenVPNAuthForm
            v-else
            :key="endpoint.tag + endpoint.challenge.id"
            :endpoint-tag="endpoint.tag"
            :challenge="endpoint.challenge"
          />
        </div>
      </template>

      <VpnTunnelRows
        v-if="endpoint.tunnel"
        :tunnel="endpoint.tunnel"
      />
    </template>

    <DialogWrapper
      v-model="qrOpen"
      :title="$t('authURL')"
    >
      <div
        v-if="qrUrl"
        class="flex flex-col items-center gap-3"
      >
        <QRCodeView :value="qrUrl" />
        <a
          :href="qrUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="link link-primary text-xs break-all"
          >{{ qrUrl }}</a
        >
      </div>
    </DialogWrapper>
  </div>
</template>

<script setup lang="ts">
import { toolErrorMessage } from '@/assembly/singbox/tools/common'
import {
  cancelOpenVPNChallenge,
  deadlineIn,
  type OpenVPNChallengeView,
  type OpenVPNEndpointView,
} from '@/assembly/singbox/tools/vpn'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { notifyRequestError } from '@/helper/request-error'
import { QrCodeIcon } from '@heroicons/vue/24/outline'
import { useNow } from '@vueuse/core'
import { onDeactivated, ref, watch } from 'vue'
import OpenVPNAuthForm from './OpenVPNAuthForm.vue'
import QRCodeView from './QRCodeView.vue'
import VpnTunnelRows from './VpnTunnelRows.vue'

const props = defineProps<{
  endpoints: OpenVPNEndpointView[]
  error: string
}>()

const now = useNow({ interval: 1000 })
const remaining = (challenge: OpenVPNChallengeView) =>
  deadlineIn(challenge, now.value.getTime() / 1000)

const STATE_BADGE: Record<string, string> = {
  connected: 'badge-success',
  connecting: 'badge-warning',
  'auth-pending': 'badge-warning',
  error: 'badge-error',
}

const statePillClass = (state: string) => STATE_BADGE[state] ?? 'badge-ghost'

const cancelling = ref(new Set<string>())
const challengeKey = (endpointTag: string, challengeID: string) => `${endpointTag}\n${challengeID}`

const cancel = (endpointTag: string, challengeID: string) => {
  const key = challengeKey(endpointTag, challengeID)

  if (cancelling.value.has(key)) return
  cancelling.value = new Set(cancelling.value).add(key)
  cancelOpenVPNChallenge(endpointTag, challengeID).catch((e: unknown) => {
    const next = new Set(cancelling.value)

    next.delete(key)
    cancelling.value = next
    notifyRequestError(new Error(toolErrorMessage(e)))
  })
}

watch(
  () => props.endpoints,
  (endpoints) => {
    const live = new Set(
      endpoints.flatMap((endpoint) =>
        endpoint.challenge ? [challengeKey(endpoint.tag, endpoint.challenge.id)] : [],
      ),
    )

    if ([...cancelling.value].some((key) => !live.has(key))) {
      cancelling.value = new Set([...cancelling.value].filter((key) => live.has(key)))
    }
  },
)

const qrOpen = ref(false)
const qrUrl = ref('')
const openQR = (url: string) => {
  qrUrl.value = url
  qrOpen.value = true
}

onDeactivated(() => {
  qrOpen.value = false
})
</script>
