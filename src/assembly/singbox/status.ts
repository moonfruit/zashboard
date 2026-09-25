import type { MemorySample, TrafficSample } from '@/assembly/driver/types'
import type { Status } from './api/gen/daemon/started_service_pb'
import type { SingboxRuntime } from './api/state'

export const toTrafficSample = (status: Status): TrafficSample => ({
  down: Number(status.downlink),
  up: Number(status.uplink),
  downTotal: Number(status.downlinkTotal),
  upTotal: Number(status.uplinkTotal),
})

export const toMemorySample = (status: Status): MemorySample => ({
  inuse: Number(status.memory),
})

export const toRuntime = (status: Status, previous?: SingboxRuntime): SingboxRuntime => ({
  startedAt: previous?.startedAt ?? 0,
  goroutines: status.goroutines,
  connectionsIn: status.connectionsIn,
  connectionsOut: status.connectionsOut,
})

const pad = (value: number) => String(value).padStart(2, '0')

export const formatUptime = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60

  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}
