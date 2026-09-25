import { serverStream, toApiError } from './client'
import { StartedService } from './gen/daemon/started_service_pb'
import { fallBackToClash } from './probe'
import { createSharedStream, retryAllStreams } from './stream'

const SECOND = 1_000_000_000n

const options = {
  onTerminal: (error: unknown) => {
    fallBackToClash(toApiError(error))
  },
}

export const statusStream = createSharedStream(
  (signal) => serverStream(StartedService.method.subscribeStatus, { interval: SECOND }, signal),
  { ...options, idleTimeoutMs: 5000 },
)

export const connectionsStream = createSharedStream(
  (signal) =>
    serverStream(StartedService.method.subscribeConnections, { interval: SECOND }, signal),
  options,
)

export const logStream = createSharedStream(
  (signal) => serverStream(StartedService.method.subscribeLog, {}, signal),
  options,
)

export const groupsStream = createSharedStream(
  (signal) => serverStream(StartedService.method.subscribeGroups, {}, signal),
  options,
)

export const clashModeStream = createSharedStream(
  (signal) => serverStream(StartedService.method.subscribeClashMode, {}, signal),
  options,
)

if (typeof window !== 'undefined') {
  window.addEventListener('online', retryAllStreams)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') retryAllStreams()
  })
}
