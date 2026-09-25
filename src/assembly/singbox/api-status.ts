import { computed } from 'vue'
import { singboxApi, singboxApiError, singboxApiModule, type SingboxApiError } from './api/state'
import { singboxVariant } from './variant'

export type SingboxApiStatus =
  | { state: 'connected'; apiVersion: number }
  | { state: 'reconnecting' }
  | { state: 'failed'; reason: SingboxApiError }

const isReconnecting = () => {
  const runtime = singboxApiModule.value

  if (!runtime) return false

  return [
    runtime.statusStream,
    runtime.connectionsStream,
    runtime.logStream,
    runtime.groupsStream,
    runtime.clashModeStream,
  ].some((stream) => stream.phase.value === 'connecting' && stream.error.value !== undefined)
}

export const singboxApiStatus = computed<SingboxApiStatus | undefined>(() => {
  if (singboxVariant.value !== 'moonfruit') return undefined
  if (singboxApi.value) {
    if (isReconnecting()) return { state: 'reconnecting' }
    return { state: 'connected', apiVersion: singboxApi.value.apiVersion }
  }
  if (singboxApiError.value) return { state: 'failed', reason: singboxApiError.value }
  return undefined
})
