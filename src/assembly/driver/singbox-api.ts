import {
  dedupeBacklog,
  DELIVERED_LIMIT,
  passesLevel,
  toLog,
  toLogLevel,
} from '@/assembly/singbox/api-logs'
import type { ClashMode } from '@/assembly/singbox/api/gen/daemon/started_service_pb'
import { singboxApiModule, singboxRuntime } from '@/assembly/singbox/api/state'
import type { SharedStream } from '@/assembly/singbox/api/stream'
import {
  createConnectionAccumulator,
  singboxConnectionAccessor,
} from '@/assembly/singbox/connection-events'
import { createChangeDetector, groupsSignature } from '@/assembly/singbox/events'
import { toMemorySample, toRuntime, toTrafficSample } from '@/assembly/singbox/status'
import { shallowRef } from 'vue'
import { singboxDriver } from './singbox'
import type { ConnectionsPayload, Driver, Stream } from './types'

const runtime = () => {
  const module = singboxApiModule.value

  if (!module) throw new Error('sing-box API is not loaded')
  return module
}

const fromShared = <S, T>(stream: SharedStream<S>, map: (value: S) => T): Stream<T> => {
  const data = shallowRef<T>()
  const close = stream.subscribe((value) => {
    data.value = map(value)
  })

  return { data, close }
}

const CONNECTIONS_IDLE_EMIT = 1500
const STATUS_GAP_MS = 5000

const subscribeConnections = (): Stream<ConnectionsPayload> => {
  const data = shallowRef<ConnectionsPayload>()
  const accumulator = createConnectionAccumulator()
  let timer: ReturnType<typeof setTimeout> | undefined
  let received = false

  const emit = () => {
    clearTimeout(timer)
    data.value = accumulator.drain()
    timer = setTimeout(emit, CONNECTIONS_IDLE_EMIT)
  }

  const off = runtime().connectionsStream.subscribe((message) => {
    const traffic = accumulator.apply(message)

    if (!received || traffic) {
      received = true
      emit()
    }
  })

  return {
    data,
    close: () => {
      off()
      clearTimeout(timer)
    },
  }
}

export const singboxApiDriver: Driver = {
  ...singboxDriver,
  events: {
    subscribe: (onEvent) => {
      const groupsChanged = createChangeDetector(groupsSignature)
      const modeChanged = createChangeDetector((mode: ClashMode) => mode.mode.toLowerCase())
      const offGroups = runtime().groupsStream.subscribe((groups) => {
        if (groupsChanged(groups)) onEvent('proxies.changed', undefined)
      })
      const offMode = runtime().clashModeStream.subscribe((mode) => {
        if (modeChanged(mode)) onEvent('configs.changed', undefined)
      })

      return {
        close: () => {
          offGroups()
          offMode()
        },
      }
    },
  },
  metrics: {
    ...singboxDriver.metrics,
    traffic: () => {
      let lastStatusAt: number | undefined

      return fromShared(runtime().statusStream, (status) => {
        const now = Date.now()

        if (lastStatusAt !== undefined && now - lastStatusAt > STATUS_GAP_MS) {
          runtime()
            .api()
            .getStartedAt({})
            .then((result) => {
              if (singboxRuntime.value) {
                singboxRuntime.value = {
                  ...singboxRuntime.value,
                  startedAt: Number(result.startedAt),
                }
              }
            })
            .catch(() => {})
        }

        lastStatusAt = now
        singboxRuntime.value = toRuntime(status, singboxRuntime.value)
        return toTrafficSample(status)
      })
    },
    memory: () => fromShared(runtime().statusStream, toMemorySample),
  },
  logs: {
    subscribe: (level, onBatch, onReset) => {
      let delivered: string[] = []
      let first = true

      const close = runtime().logStream.subscribe((message, { firstOfConnection }) => {
        const backlog = message.reset && (first || firstOfConnection)
        let items = message.messages

        if (message.reset && !backlog) {
          delivered = []
          onReset?.()
        } else if (backlog && !first) {
          const raw = items.map((item) => item.message)

          items = items.slice(raw.length - dedupeBacklog(delivered, raw).length)
        }

        first = false
        delivered = delivered.concat(items.map((item) => item.message)).slice(-DELIVERED_LIMIT)

        const baseMs = backlog ? singboxRuntime.value?.startedAt : undefined
        const logs = items
          .filter((item) => passesLevel(toLogLevel(item.level), level))
          .map((item) => toLog(item, baseMs))

        if (logs.length) onBatch(logs)
      })

      return { close }
    },
  },
  connections: {
    ...singboxDriver.connections,
    accessor: singboxConnectionAccessor,
    subscribe: subscribeConnections,
    disconnect: async (id) => {
      await runtime().api().closeConnection({ id })
    },
    disconnectAll: async (filter) => {
      if (filter) return singboxDriver.connections.disconnectAll(filter)
      await runtime().api().closeAllConnections({})
    },
  },
}
