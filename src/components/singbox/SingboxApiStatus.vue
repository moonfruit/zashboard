<template>
  <div
    v-if="status"
    class="flex flex-wrap items-center gap-2 px-1 text-xs"
  >
    <span class="text-base-content/60">{{ $t('singboxApi') }}</span>
    <span :class="status.tone">{{ status.text }}</span>
  </div>
</template>

<script setup lang="ts">
import { singboxApiStatus } from '@/assembly/singbox/api-status'
import type { SingboxApiError } from '@/assembly/singbox/api/state'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const FAILURE_KEYS: Record<SingboxApiError, string> = {
  unauthorized: 'singboxApiUnauthorized',
  unimplemented: 'singboxApiUnimplemented',
  timeout: 'singboxApiTimeout',
  network: 'singboxApiNetwork',
  subpath: 'singboxApiSubpath',
}

const status = computed(() => {
  const value = singboxApiStatus.value

  if (!value) return undefined
  if (value.state === 'connected') {
    return {
      tone: 'text-success',
      text: t('singboxApiConnected', { version: String(value.apiVersion) }),
    }
  }
  if (value.state === 'reconnecting') {
    return { tone: 'text-warning', text: t('singboxApiReconnecting') }
  }
  return { tone: 'text-error', text: t(FAILURE_KEYS[value.reason]) }
})
</script>
