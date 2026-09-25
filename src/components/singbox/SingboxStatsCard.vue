<template>
  <div
    v-if="isVisible"
    class="base-container w-full backdrop-blur-none!"
  >
    <div class="surface flex items-center justify-between p-4">
      <div
        class="text-base-content/60 flex items-center gap-2 text-xs font-semibold tracking-wider uppercase"
      >
        {{ t('singboxStatsCard') }}
      </div>
    </div>
    <div class="surface grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-4">
      <div
        v-for="item in items"
        :key="item.label"
        class="bg-base-200/30 flex flex-col gap-1.5 rounded-xl p-4"
      >
        <div class="text-base-content/60 text-xs font-semibold tracking-wider uppercase">
          {{ item.label }}
        </div>
        <div class="text-2xl font-extralight tabular-nums">{{ item.value }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { can } from '@/assembly/backend'
import { singboxRuntime } from '@/assembly/singbox/api/state'
import { formatUptime } from '@/assembly/singbox/status'
import { useNow } from '@vueuse/core'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const now = useNow({ interval: 1000 })

const isVisible = computed(() => can('singboxApi') && !!singboxRuntime.value)

const items = computed(() => {
  const runtime = singboxRuntime.value

  if (!runtime) return []

  return [
    {
      label: t('singboxUptime'),
      value: runtime.startedAt ? formatUptime(now.value.getTime() - runtime.startedAt) : '-',
    },
    { label: t('singboxGoroutines'), value: String(runtime.goroutines) },
    { label: t('singboxConnectionsIn'), value: String(runtime.connectionsIn) },
    { label: t('singboxConnectionsOut'), value: String(runtime.connectionsOut) },
  ]
})
</script>
