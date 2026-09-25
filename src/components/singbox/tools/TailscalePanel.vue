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
            {{ endpoint.tag || 'Tailscale' }}
          </span>
          <span
            class="badge badge-sm"
            :class="statePillClass(endpoint.backendState)"
          >
            {{ endpoint.backendState || $t('unknown') }}
          </span>
          <span
            v-if="endpoint.stateText && endpoint.stateText !== endpoint.backendState"
            class="text-base-content/60 text-xs"
          >
            {{ endpoint.stateText }}
          </span>
        </span>
        <button
          v-if="!endpoint.keyAuth"
          class="text-error/90 hover:text-error flex items-center gap-1 text-xs tracking-normal"
          @click="openLogoutConfirm(endpoint)"
        >
          <ArrowRightOnRectangleIcon class="h-4 w-4" />
          {{ $t('logout') }}
        </button>
      </div>

      <div class="settings-grid">
        <button
          v-if="endpoint.self"
          class="setting-item hover:bg-base-content/3 active:bg-base-content/5 w-full text-left transition-colors"
          @click="openPeerDetail(endpoint, endpoint.self, true)"
        >
          <span class="setting-item-label">{{ $t('thisDevice') }}</span>
          <span class="text-base-content/50 truncate text-sm">{{
            peerDisplayName(endpoint.self)
          }}</span>
          <ChevronRightIcon class="text-base-content/25 h-4 w-4 shrink-0" />
        </button>
        <button
          v-if="endpoint.exitNodeOptions.length > 0"
          class="setting-item hover:bg-base-content/3 active:bg-base-content/5 w-full text-left transition-colors"
          @click="openExitPicker(endpoint)"
        >
          <span class="setting-item-label">{{ $t('exitNode') }}</span>
          <span class="text-base-content/50 truncate text-sm">
            {{ endpoint.exitNode ? peerDisplayName(endpoint.exitNode) : $t('disabledLabel') }}
          </span>
          <ChevronRightIcon class="text-base-content/25 h-4 w-4 shrink-0" />
        </button>
        <div
          v-if="endpoint.networkName"
          class="setting-item"
        >
          <span class="setting-item-label">{{ $t('networkLabel') }}</span>
          <span class="text-base-content/50 truncate text-sm">{{ endpoint.networkName }}</span>
        </div>
        <div
          v-if="endpoint.magicDNSSuffix"
          class="setting-item"
        >
          <span class="setting-item-label">{{ $t('tailscaleMagicDNS') }}</span>
          <span class="text-base-content/50 truncate text-sm">{{ endpoint.magicDNSSuffix }}</span>
        </div>
        <button
          v-if="endpoint.authURL"
          class="setting-item hover:bg-base-content/3 active:bg-base-content/5 w-full text-left transition-colors"
          :title="$t('showAuthQR')"
          @click="openAuthQR(endpoint)"
        >
          <span class="setting-item-label">{{ $t('authURL') }}</span>
          <span class="text-base-content/50 truncate text-sm">{{ $t('signInRequired') }}</span>
          <QrCodeIcon class="text-base-content/25 h-4 w-4 shrink-0" />
        </button>
      </div>

      <template
        v-for="user in visiblePeerGroups(endpoint)"
        :key="user.id"
      >
        <div class="settings-section-label">
          {{ user.name || $t('peers') }}
        </div>
        <div class="settings-grid">
          <button
            v-for="peer in user.peers"
            :key="peer.stableID"
            class="setting-item hover:bg-base-content/3 active:bg-base-content/5 w-full text-left transition-colors"
            @click="openPeerDetail(endpoint, peer, false)"
          >
            <span class="flex min-w-0 flex-1 items-center gap-2.5">
              <span
                class="inline-block h-2 w-2 shrink-0 rounded-full"
                :class="peer.online ? 'bg-success' : 'bg-base-content/20'"
              ></span>
              <span class="truncate text-sm">{{ peerDisplayName(peer) }}</span>
              <span class="text-base-content/40 truncate text-xs">{{ peer.ips[0] }}</span>
            </span>
            <span
              v-if="peer.exitNode || peer.exitNodeOption"
              class="badge badge-sm shrink-0"
              :class="peer.exitNode ? 'badge-primary' : 'badge-info'"
              >{{ $t('exitNode') }}</span
            >
            <span
              v-if="peer.shareeNode"
              class="badge badge-sm badge-ghost shrink-0"
              >{{ $t('sharedIn') }}</span
            >
            <span
              v-if="peerExpiry(peer) === 'expired'"
              class="badge badge-sm badge-error shrink-0"
              >{{ $t('expired') }}</span
            >
            <span
              v-else-if="peerExpiry(peer) === 'soon'"
              class="badge badge-sm badge-warning shrink-0"
              >{{ $t('expiringSoon') }}</span
            >
            <ChevronRightIcon class="text-base-content/25 h-4 w-4 shrink-0" />
          </button>
        </div>
      </template>
    </template>

    <TailscalePeerDialog
      v-if="peerDetail"
      v-model="peerDetailOpen"
      :endpoint="peerDetail.endpoint"
      :peer="peerDetail.peer"
      :is-self="peerRef?.isSelf ?? false"
    />
    <TailscaleExitNodeDialog
      v-if="exitPicker"
      v-model="exitPickerOpen"
      :endpoint="exitPicker"
      :candidates="exitPicker.exitNodeOptions"
    />
    <DialogWrapper
      v-model="authQROpen"
      :title="$t('authURL')"
    >
      <div
        v-if="authQR"
        class="flex flex-col items-center gap-3"
      >
        <QRCodeView :value="authQR.authURL" />
        <a
          :href="authQR.authURL"
          target="_blank"
          rel="noopener noreferrer"
          class="link link-primary text-xs break-all"
          >{{ $t('tailscaleLogin') }}</a
        >
      </div>
    </DialogWrapper>
    <DialogWrapper
      v-model="logoutConfirmOpen"
      :title="$t('logout')"
    >
      <div class="flex flex-col gap-4">
        <p class="text-sm">{{ $t('logoutConfirm') }}</p>
        <div class="flex justify-end gap-2">
          <button
            class="btn btn-sm"
            :disabled="logoutPending"
            @click="logoutConfirmOpen = false"
          >
            {{ $t('cancel') }}
          </button>
          <button
            class="btn btn-sm btn-error"
            :disabled="logoutPending"
            @click="confirmLogout"
          >
            <span
              v-if="logoutPending"
              class="loading loading-spinner loading-xs"
            ></span>
            {{ $t('logout') }}
          </button>
        </div>
      </div>
    </DialogWrapper>
  </div>
</template>

<script setup lang="ts">
import { toolErrorMessage } from '@/assembly/singbox/tools/common'
import {
  expiryState,
  findTailscalePeer,
  logoutTailscale,
  type TailscaleEndpointView,
  type TailscalePeerRef,
  type TailscalePeerView,
  type TailscaleUserView,
} from '@/assembly/singbox/tools/tailscale'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import QRCodeView from '@/components/singbox/tools/QRCodeView.vue'
import { notifyRequestError } from '@/helper/request-error'
import { ArrowRightOnRectangleIcon, ChevronRightIcon, QrCodeIcon } from '@heroicons/vue/24/outline'
import { computed, onDeactivated, ref, watch } from 'vue'
import TailscaleExitNodeDialog from './TailscaleExitNodeDialog.vue'
import TailscalePeerDialog from './TailscalePeerDialog.vue'

const props = defineProps<{
  endpoints: TailscaleEndpointView[]
  error: string
}>()

const peerDisplayName = (peer: TailscalePeerView) =>
  peer.hostName || peer.dnsName.split('.')[0] || peer.ips[0] || ''

const visiblePeerGroups = (endpoint: TailscaleEndpointView): TailscaleUserView[] =>
  endpoint.users.filter((user) => user.peers.length > 0)

const STATE_BADGE: Record<string, string> = {
  Running: 'badge-success',
  NeedsLogin: 'badge-warning',
  NeedsMachineAuth: 'badge-warning',
}

const statePillClass = (state: string) => STATE_BADGE[state] ?? 'badge-ghost'

const peerExpiry = (peer: TailscalePeerView) => expiryState(peer, Date.now() / 1000)

const endpointByTag = (tag: string) => props.endpoints.find((endpoint) => endpoint.tag === tag)

const peerRef = ref<TailscalePeerRef>()
const peerDetail = computed(() =>
  peerRef.value ? findTailscalePeer(props.endpoints, peerRef.value) : undefined,
)
const peerDetailOpen = ref(false)
const openPeerDetail = (
  endpoint: TailscaleEndpointView,
  peer: TailscalePeerView,
  isSelf: boolean,
) => {
  peerRef.value = { tag: endpoint.tag, stableID: peer.stableID, isSelf }
  peerDetailOpen.value = true
}

const exitPickerTag = ref<string>()
const exitPicker = computed(() =>
  exitPickerTag.value === undefined ? undefined : endpointByTag(exitPickerTag.value),
)
const exitPickerOpen = ref(false)
const openExitPicker = (endpoint: TailscaleEndpointView) => {
  exitPickerTag.value = endpoint.tag
  exitPickerOpen.value = true
}

const authQRTag = ref<string>()
const authQR = computed(() => {
  if (authQRTag.value === undefined) return undefined
  const endpoint = endpointByTag(authQRTag.value)
  return endpoint?.authURL ? endpoint : undefined
})
const authQROpen = ref(false)
const openAuthQR = (endpoint: TailscaleEndpointView) => {
  authQRTag.value = endpoint.tag
  authQROpen.value = true
}

const logoutTarget = ref('')
const logoutConfirmOpen = ref(false)
const logoutPending = ref(false)
const openLogoutConfirm = (endpoint: TailscaleEndpointView) => {
  logoutTarget.value = endpoint.tag
  logoutConfirmOpen.value = true
}

const confirmLogout = async () => {
  if (logoutPending.value) return
  logoutPending.value = true
  try {
    await logoutTailscale(logoutTarget.value)
    logoutConfirmOpen.value = false
  } catch (e) {
    notifyRequestError(new Error(toolErrorMessage(e)))
  } finally {
    logoutPending.value = false
  }
}

watch(peerDetail, (detail) => {
  if (!detail) peerDetailOpen.value = false
})
watch(exitPicker, (endpoint) => {
  if (!endpoint) exitPickerOpen.value = false
})
watch(authQR, (endpoint) => {
  if (!endpoint) authQROpen.value = false
})
watch(
  () => endpointByTag(logoutTarget.value),
  (endpoint) => {
    if (!endpoint && !logoutPending.value) logoutConfirmOpen.value = false
  },
)

onDeactivated(() => {
  peerDetailOpen.value = false
  exitPickerOpen.value = false
  authQROpen.value = false
  if (!logoutPending.value) logoutConfirmOpen.value = false
})
</script>
