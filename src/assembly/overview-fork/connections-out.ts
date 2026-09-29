import { singboxApi, singboxRuntime } from '@/assembly/singbox/api/state'
import { computed, ref } from 'vue'
import type { HistoryPoint } from '../overview'

export const outboundConnectionsAvailable = computed(
  () => singboxApi.value !== undefined && singboxRuntime.value !== undefined,
)

export const outboundConnectionCount = computed(() => singboxRuntime.value?.connectionsOut ?? 0)

export const outboundConnectionsHistory = ref<HistoryPoint[]>([])

export const resetOutboundConnections = () => {
  outboundConnectionsHistory.value = []
}

export const pushOutboundConnections = (timestamp: number, limit: number) => {
  if (!outboundConnectionsAvailable.value) {
    if (outboundConnectionsHistory.value.length) resetOutboundConnections()
    return
  }

  outboundConnectionsHistory.value = [
    ...outboundConnectionsHistory.value,
    { name: timestamp, value: [timestamp, outboundConnectionCount.value] as [number, number] },
  ].slice(-limit)
}
