import type { ConnectionAccessor, ConnectionsPayload } from '@/assembly/driver/types'
import type { Connection, SingboxConnectionRawMessage } from '@/types'
import type {
  ConnectionEvents,
  Connection as PbConnection,
} from './api/gen/daemon/started_service_pb'

const EVENT_NEW = 0
const EVENT_UPDATE = 1
const EVENT_CLOSED = 2
const CLOSED_ID_LIMIT = 5000

export const toRawConnection = (connection: PbConnection): SingboxConnectionRawMessage => ({
  id: connection.id,
  inbound: connection.inbound,
  inboundType: connection.inboundType,
  ipVersion: connection.ipVersion,
  network: connection.network,
  source: connection.source,
  destination: connection.destination,
  domain: connection.domain,
  sniffHost: connection.sniffHost,
  protocol: connection.protocol,
  user: connection.user,
  fromOutbound: connection.fromOutbound,
  createdAt: Number(connection.createdAt),
  closedAt: Number(connection.closedAt),
  uplinkTotal: Number(connection.uplinkTotal),
  downlinkTotal: Number(connection.downlinkTotal),
  rule: connection.rule,
  outbound: connection.outbound,
  outboundType: connection.outboundType,
  chainList: [...connection.chainList],
  processPath: connection.processInfo?.processPath ?? '',
  packageNames: [...(connection.processInfo?.packageNames ?? [])],
})

export const createConnectionAccumulator = () => {
  let active = new Map<string, SingboxConnectionRawMessage>()
  const closedIds = new Set<string>()
  let pendingClosed: SingboxConnectionRawMessage[] = []
  let applied = false
  let pendingReset = false

  const close = (connection: SingboxConnectionRawMessage) => {
    if (closedIds.has(connection.id)) return
    closedIds.add(connection.id)
    if (closedIds.size > CLOSED_ID_LIMIT) {
      closedIds.delete(closedIds.values().next().value as string)
    }
    pendingClosed.push(connection)
  }

  return {
    apply(message: ConnectionEvents) {
      let traffic = message.reset

      if (message.reset) {
        active = new Map()
        pendingReset = applied
      }
      applied = true

      for (const event of message.events) {
        if (event.type === EVENT_NEW && event.connection) {
          const connection = toRawConnection(event.connection)

          if (connection.closedAt > 0) close(connection)
          else active.set(connection.id, connection)
        } else if (event.type === EVENT_UPDATE) {
          const current = active.get(event.id)

          traffic = true
          if (current) {
            active.set(event.id, {
              ...current,
              uplinkTotal: current.uplinkTotal + Number(event.uplinkDelta),
              downlinkTotal: current.downlinkTotal + Number(event.downlinkDelta),
            })
          }
        } else if (event.type === EVENT_CLOSED) {
          const current = event.connection
            ? toRawConnection(event.connection)
            : active.get(event.id)

          active.delete(event.id)
          if (current) close({ ...current, closedAt: Number(event.closedAt) || current.closedAt })
        }
      }

      return traffic
    },
    drain(): ConnectionsPayload {
      const closed = pendingClosed
      const reset = pendingReset

      pendingClosed = []
      pendingReset = false
      return { connections: [...active.values()], closed, reset }
    },
  }
}

export const splitHostPort = (address: string): [string, string] => {
  const bracketed = /^\[(.*)\]:(\d+)$/.exec(address)

  if (bracketed) return [bracketed[1], bracketed[2]]

  const index = address.lastIndexOf(':')

  if (index === -1 || address.indexOf(':') !== index) return [address, '']
  return [address.slice(0, index), address.slice(index + 1)]
}

const joinHostPort = (host: string, port: string) => {
  if (!port) return host
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}

const asSingbox = (connection: Connection) => connection as SingboxConnectionRawMessage & Connection

const hostOf = (connection: SingboxConnectionRawMessage) =>
  connection.domain || splitHostPort(connection.destination)[0]

export const singboxConnectionAccessor: ConnectionAccessor = {
  chains: (connection) => asSingbox(connection).chainList,
  download: (connection) => asSingbox(connection).downlinkTotal,
  upload: (connection) => asSingbox(connection).uplinkTotal,
  start: (connection) => asSingbox(connection).createdAt,
  rule: (connection) => asSingbox(connection).rule || 'final',
  rulePayload: () => '',
  sourceIP: (connection) => splitHostPort(asSingbox(connection).source)[0],
  sourcePort: (connection) => splitHostPort(asSingbox(connection).source)[1],
  network: (connection) => asSingbox(connection).network,
  networkType: (connection) => {
    const singbox = asSingbox(connection)
    const inbound = singbox.inbound
      ? `${singbox.inboundType}/${singbox.inbound}`
      : singbox.inboundType

    return `${inbound} | ${singbox.network}`
  },
  hostname: (connection) => hostOf(asSingbox(connection)),
  host: (connection) => {
    const singbox = asSingbox(connection)

    return joinHostPort(hostOf(singbox), splitHostPort(singbox.destination)[1])
  },
  process: (connection) => {
    const singbox = asSingbox(connection)

    return singbox.processPath.replace(/^.*[/\\]/, '') || singbox.packageNames[0] || '-'
  },
  destination: (connection) => splitHostPort(asSingbox(connection).destination)[0],
  inboundUser: (connection) => asSingbox(connection).user || '-',
  sniffHost: (connection) => asSingbox(connection).sniffHost,
  remoteAddress: () => '',
  isDirect: (connection) => asSingbox(connection).outboundType === 'direct',
  smartBlock: () => undefined,
  protocol: (connection) => asSingbox(connection).protocol,
  inbound: (connection) => asSingbox(connection).inbound,
  fromOutbound: (connection) => asSingbox(connection).fromOutbound,
  outboundType: (connection) => asSingbox(connection).outboundType,
}
