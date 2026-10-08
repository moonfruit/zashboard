import { can } from '@/assembly/backend'
import { singboxRuntime } from '@/assembly/singbox/api/state'
import { formatUptime } from '@/assembly/singbox/status'
import { useNow } from '@vueuse/core'
import { computed } from 'vue'

const now = useNow({ interval: 1000 })

export const singboxRuntimeStats = computed(() => {
  const runtime = singboxRuntime.value

  if (!can('singboxApi') || !runtime) return undefined

  return {
    uptime: runtime.startedAt ? formatUptime(now.value.getTime() - runtime.startedAt) : '-',
    goroutines: runtime.goroutines,
  }
})

export const singboxRuntimeStatGrid = computed(() => {
  const stats = singboxRuntimeStats.value

  if (!stats) return []

  return [
    { key: 'singboxUptime', label: 'singboxUptime', value: stats.uptime },
    { key: 'singboxGoroutines', label: 'singboxGoroutines', value: stats.goroutines },
  ]
})
