<template>
  <div class="flex flex-col">
    <div class="flex items-center justify-end gap-2">
      <span
        v-if="error"
        class="text-error flex-1 text-sm"
        >{{ error }}</span
      >
      <button
        class="btn btn-sm"
        :disabled="loading"
        @click="emit('refresh')"
      >
        <span
          v-if="loading"
          class="loading loading-spinner loading-xs"
        ></span>
        {{ $t('ebpfRefresh') }}
      </button>
    </div>

    <template
      v-for="inbound in diagnostics?.inbounds ?? []"
      :key="inbound.tag"
    >
      <div class="settings-section-label">
        <span class="normal-case">{{ inbound.tag }}</span>
      </div>
      <div class="settings-grid">
        <div class="setting-item">
          <span class="setting-item-label">{{ $t('ebpfState') }}</span>
          <span
            class="font-mono text-sm"
            :class="stateClass(inbound.state)"
            >{{ inbound.state || '-' }}</span
          >
        </div>
        <div class="setting-item">
          <span class="setting-item-label">{{ $t('ebpfDataPlane') }}</span>
          <span class="text-base-content/50 font-mono text-sm">{{ inbound.dataPlane || '-' }}</span>
        </div>
        <div class="setting-item">
          <span class="setting-item-label">{{ $t('ebpfUdpSessions') }}</span>
          <span class="text-base-content/50 font-mono text-sm tabular-nums">{{
            inbound.udpSessions
          }}</span>
        </div>
        <div
          v-if="inbound.lastError"
          class="setting-item items-start py-3"
        >
          <span class="setting-item-label shrink-0 grow-0">{{ $t('ebpfLastError') }}</span>
          <span class="text-error min-w-0 flex-1 text-right text-sm break-words">{{
            inbound.lastError
          }}</span>
        </div>
        <details class="collapse-arrow collapse rounded-none">
          <summary class="collapse-title text-sm">{{ $t('ebpfRawData') }}</summary>
          <div class="collapse-content overflow-x-auto">
            <VueJsonPretty :data="inbound.detail" />
          </div>
        </details>
      </div>
    </template>

    <template v-if="diagnostics?.kernelRuntime">
      <div class="settings-section-label">{{ $t('ebpfKernelRuntime') }}</div>
      <div class="settings-grid">
        <details class="collapse-arrow collapse rounded-none">
          <summary class="collapse-title text-sm">{{ $t('ebpfRawData') }}</summary>
          <div class="collapse-content overflow-x-auto">
            <VueJsonPretty :data="diagnostics.kernelRuntime" />
          </div>
        </details>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { EbpfDiagnostics } from '@/assembly/singbox/tools/ebpf'
import VueJsonPretty from 'vue-json-pretty'
import 'vue-json-pretty/lib/styles.css'

defineProps<{
  diagnostics: EbpfDiagnostics | undefined
  error: string
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'refresh'): void
}>()

const STATE_CLASS: Record<string, string> = {
  normal: 'text-success',
  waiting_for_interface: 'text-warning',
  recovering: 'text-warning',
  needs_attention: 'text-error',
}

const stateClass = (state: string) => STATE_CLASS[state] ?? 'text-base-content/50'
</script>
