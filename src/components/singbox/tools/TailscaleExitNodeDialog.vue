<template>
  <DialogWrapper
    v-model="isOpen"
    :title="$t('exitNode')"
  >
    <div class="flex flex-col gap-2">
      <input
        ref="searchEl"
        v-model="query"
        class="input input-sm w-full"
        :placeholder="$t('search')"
      />
      <div
        class="divide-base-content/8 bg-base-200/40 max-h-96 divide-y overflow-y-auto rounded-xl"
      >
        <button
          class="setting-item hover:bg-base-content/3 active:bg-base-content/5 w-full text-left transition-colors"
          :disabled="pending !== undefined"
          @click="select('')"
        >
          <span class="setting-item-label">{{ $t('disabledLabel') }}</span>
          <span
            v-if="pending === ''"
            class="loading loading-spinner loading-xs shrink-0"
          ></span>
          <CheckIcon
            v-else-if="current === ''"
            class="text-primary h-4 w-4 shrink-0"
          />
        </button>
        <button
          v-for="peer in filtered"
          :key="peer.stableID"
          class="setting-item hover:bg-base-content/3 active:bg-base-content/5 w-full text-left transition-colors"
          :disabled="pending !== undefined"
          @click="select(peer.stableID)"
        >
          <span
            class="inline-block h-2 w-2 shrink-0 rounded-full"
            :class="peer.online ? 'bg-success' : 'bg-base-content/20'"
          ></span>
          <span class="setting-item-label flex min-w-0 items-center gap-2">
            <span class="truncate text-sm">{{ peerDisplayName(peer) }}</span>
            <span class="text-base-content/40 truncate text-xs">{{ peer.ips[0] }}</span>
          </span>
          <span
            v-if="pending === peer.stableID"
            class="loading loading-spinner loading-xs shrink-0"
          ></span>
          <CheckIcon
            v-else-if="current === peer.stableID"
            class="text-primary h-4 w-4 shrink-0"
          />
        </button>
      </div>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import { toolErrorMessage } from '@/assembly/singbox/tools/common'
import {
  setTailscaleExitNode,
  type TailscaleEndpointView,
  type TailscalePeerView,
} from '@/assembly/singbox/tools/tailscale'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { notifyRequestError } from '@/helper/request-error'
import { CheckIcon } from '@heroicons/vue/24/outline'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'

const props = defineProps<{
  endpoint: TailscaleEndpointView
  candidates: TailscalePeerView[]
}>()
const isOpen = defineModel<boolean>()

const query = ref('')
const pending = ref<string>()
const searchEl = useTemplateRef<HTMLInputElement>('searchEl')
const current = computed(() => props.endpoint.exitNode?.stableID ?? '')

const peerDisplayName = (peer: TailscalePeerView) =>
  peer.hostName || peer.dnsName.split('.')[0] || peer.ips[0] || ''

const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (keyword === '') return props.candidates
  return props.candidates.filter(
    (peer) =>
      peerDisplayName(peer).toLowerCase().includes(keyword) ||
      peer.hostName.toLowerCase().includes(keyword) ||
      peer.dnsName.toLowerCase().includes(keyword) ||
      peer.ips.some((address) => address.includes(keyword)),
  )
})

watch(
  isOpen,
  async (open) => {
    if (!open) return
    query.value = ''
    await nextTick()
    requestAnimationFrame(() => searchEl.value?.focus())
  },
  { immediate: true },
)

const select = async (stableID: string) => {
  if (pending.value !== undefined) return
  pending.value = stableID
  try {
    await setTailscaleExitNode(props.endpoint.tag, stableID)
    isOpen.value = false
  } catch (e) {
    notifyRequestError(new Error(toolErrorMessage(e)))
  } finally {
    pending.value = undefined
  }
}
</script>
