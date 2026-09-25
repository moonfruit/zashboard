import { singboxDriver } from '@/assembly/driver/singbox'
import { singboxApiDriver } from '@/assembly/driver/singbox-api'
import {
  ConnectionEventsSchema,
  ConnectionEventType,
  ConnectionSchema,
  type ConnectionEvents,
} from '@/assembly/singbox/api/gen/daemon/started_service_pb'
import {
  createConnectionAccumulator,
  singboxConnectionAccessor,
  splitHostPort,
  toRawConnection,
} from '@/assembly/singbox/connection-events'
import type { Connection, SingboxConnectionRawMessage } from '@/types'
import { create, type MessageInitShape } from '@bufbuild/protobuf'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeShared, installRuntime } from './fake-runtime'

const pbConnection = (init: MessageInitShape<typeof ConnectionSchema>) =>
  create(ConnectionSchema, {
    inbound: 'tun-in',
    inboundType: 'tun',
    network: 'tcp',
    source: '172.19.0.1:50000',
    destination: '1.1.1.1:443',
    createdAt: 1000n,
    rule: 'rule_set=geosite-cn',
    outbound: 'proxy',
    outboundType: 'vless',
    chainList: ['node-a', 'proxy'],
    ...init,
  })

const events = (init: MessageInitShape<typeof ConnectionEventsSchema>) =>
  create(ConnectionEventsSchema, init)

const NEW = ConnectionEventType.CONNECTION_EVENT_NEW
const UPDATE = ConnectionEventType.CONNECTION_EVENT_UPDATE
const CLOSED = ConnectionEventType.CONNECTION_EVENT_CLOSED

const ids = (list: { id: string }[]) => list.map((item) => item.id)

describe('accumulator', () => {
  it('builds the active set from reset and splits already closed ones', () => {
    const acc = createConnectionAccumulator()
    const traffic = acc.apply(
      events({
        reset: true,
        events: [
          { type: NEW, id: 'a', connection: pbConnection({ id: 'a' }) },
          { type: NEW, id: 'b', connection: pbConnection({ id: 'b', closedAt: 5000n }) },
        ],
      }),
    )
    const payload = acc.drain()

    expect(traffic).toBe(true)
    expect(ids(payload.connections)).toEqual(['a'])
    expect(ids(payload.closed ?? [])).toEqual(['b'])
    expect(acc.drain().closed).toEqual([])
  })

  it('accumulates deltas and reports updates', () => {
    const acc = createConnectionAccumulator()

    acc.apply(
      events({
        reset: true,
        events: [
          {
            type: NEW,
            id: 'a',
            connection: pbConnection({ id: 'a', uplinkTotal: 1n, downlinkTotal: 2n }),
          },
        ],
      }),
    )
    expect(
      acc.apply(
        events({ events: [{ type: UPDATE, id: 'a', uplinkDelta: 10n, downlinkDelta: 20n }] }),
      ),
    ).toBe(true)
    expect(
      acc.apply(
        events({ events: [{ type: NEW, id: 'c', connection: pbConnection({ id: 'c' }) }] }),
      ),
    ).toBe(false)

    const [a] = acc.drain().connections as SingboxConnectionRawMessage[]
    expect(a.uplinkTotal).toBe(11)
    expect(a.downlinkTotal).toBe(22)
  })

  it('moves closed connections once and rebuilds on a later reset', () => {
    const acc = createConnectionAccumulator()

    acc.apply(
      events({
        reset: true,
        events: [{ type: NEW, id: 'a', connection: pbConnection({ id: 'a' }) }],
      }),
    )
    acc.apply(events({ events: [{ type: CLOSED, id: 'a', closedAt: 9000n }] }))
    const first = acc.drain()
    expect(ids(first.connections)).toEqual([])
    expect((first.closed as SingboxConnectionRawMessage[])[0].closedAt).toBe(9000)

    acc.apply(
      events({
        reset: true,
        events: [
          { type: NEW, id: 'a', connection: pbConnection({ id: 'a', closedAt: 9000n }) },
          { type: NEW, id: 'd', connection: pbConnection({ id: 'd' }) },
        ],
      }),
    )
    const second = acc.drain()
    expect(ids(second.connections)).toEqual(['d'])
    expect(second.closed).toEqual([])
  })

  it('flags the first drain after a reconnect reset so speeds are not diffed across the gap', () => {
    const acc = createConnectionAccumulator()
    const snapshot = events({
      reset: true,
      events: [{ type: NEW, id: 'a', connection: pbConnection({ id: 'a' }) }],
    })

    acc.apply(snapshot)
    expect(acc.drain().reset).toBe(false)

    acc.apply(events({ events: [{ type: UPDATE, id: 'a', downlinkDelta: 5n }] }))
    expect(acc.drain().reset).toBe(false)

    acc.apply(snapshot)
    expect(acc.drain().reset).toBe(true)
    expect(acc.drain().reset).toBe(false)
  })

  it('uses the CLOSED event connection totals for an id still in the active set', () => {
    const acc = createConnectionAccumulator()

    acc.apply(
      events({
        reset: true,
        events: [
          {
            type: NEW,
            id: 'a',
            connection: pbConnection({ id: 'a', uplinkTotal: 1n, downlinkTotal: 2n }),
          },
        ],
      }),
    )
    acc.apply(
      events({
        events: [
          {
            type: CLOSED,
            id: 'a',
            closedAt: 9000n,
            connection: pbConnection({ id: 'a', uplinkTotal: 100n, downlinkTotal: 200n }),
          },
        ],
      }),
    )

    const [closed] = acc.drain().closed as SingboxConnectionRawMessage[]
    expect(closed.uplinkTotal).toBe(100)
    expect(closed.downlinkTotal).toBe(200)
    expect(closed.closedAt).toBe(9000)
  })

  it('adds a CLOSED event for an unknown id exactly once', () => {
    const acc = createConnectionAccumulator()

    acc.apply(
      events({
        events: [
          {
            type: CLOSED,
            id: 'unknown',
            closedAt: 9000n,
            connection: pbConnection({ id: 'unknown', uplinkTotal: 3n }),
          },
        ],
      }),
    )
    acc.apply(
      events({
        events: [
          {
            type: CLOSED,
            id: 'unknown',
            closedAt: 9500n,
            connection: pbConnection({ id: 'unknown', uplinkTotal: 4n }),
          },
        ],
      }),
    )

    const payload = acc.drain()
    expect(ids(payload.closed ?? [])).toEqual(['unknown'])
  })

  it('dedupes a duplicate CLOSED event with no connection payload', () => {
    const acc = createConnectionAccumulator()

    acc.apply(
      events({
        reset: true,
        events: [{ type: NEW, id: 'a', connection: pbConnection({ id: 'a' }) }],
      }),
    )
    acc.apply(events({ events: [{ type: CLOSED, id: 'a', closedAt: 9000n }] }))
    acc.apply(events({ events: [{ type: CLOSED, id: 'a', closedAt: 9500n }] }))

    const payload = acc.drain()
    expect(ids(payload.closed ?? [])).toEqual(['a'])
  })
})

describe('accessor', () => {
  const raw = (init: MessageInitShape<typeof ConnectionSchema>) =>
    ({
      ...toRawConnection(pbConnection({ id: 'x', ...init })),
      downloadSpeed: 0,
      uploadSpeed: 0,
    }) as Connection

  it('splits host and port', () => {
    expect(splitHostPort('1.2.3.4:80')).toEqual(['1.2.3.4', '80'])
    expect(splitHostPort('[::1]:53')).toEqual(['::1', '53'])
    expect(splitHostPort('example.com:443')).toEqual(['example.com', '443'])
    expect(splitHostPort('::1')).toEqual(['::1', ''])
  })

  it('maps connection fields', () => {
    const conn = raw({
      domain: 'example.com',
      sniffHost: 'sniffed.example.com',
      processInfo: { processPath: '/usr/bin/curl' },
      user: 'alice',
      uplinkTotal: 5n,
      downlinkTotal: 6n,
    })
    const a = singboxConnectionAccessor

    expect(a.sourceIP(conn)).toBe('172.19.0.1')
    expect(a.sourcePort(conn)).toBe('50000')
    expect(a.host(conn)).toBe('example.com:443')
    expect(a.hostname(conn)).toBe('example.com')
    expect(a.destination(conn)).toBe('1.1.1.1')
    expect(a.process(conn)).toBe('curl')
    expect(a.chains(conn)).toEqual(['node-a', 'proxy'])
    expect(a.download(conn)).toBe(6)
    expect(a.upload(conn)).toBe(5)
    expect(a.start(conn)).toBe(1000)
    expect(a.networkType(conn)).toBe('tun/tun-in | tcp')
    expect(a.inboundUser(conn)).toBe('alice')
    expect(a.sniffHost(conn)).toBe('sniffed.example.com')
    expect(a.isDirect(conn)).toBe(false)
  })

  it('falls back when domain and process are missing', () => {
    const conn = raw({
      destination: '[2001:db8::1]:443',
      rule: '',
      processInfo: { packageNames: ['com.app'] },
    })

    expect(singboxConnectionAccessor.host(conn)).toBe('[2001:db8::1]:443')
    expect(singboxConnectionAccessor.rule(conn)).toBe('final')
    expect(singboxConnectionAccessor.process(conn)).toBe('com.app')
  })
})

describe('singboxApiDriver.connections', () => {
  const stream = fakeShared<ConnectionEvents>()
  const closeConnection = vi.fn().mockResolvedValue({})
  const closeAllConnections = vi.fn().mockResolvedValue({})

  beforeEach(() => {
    vi.useFakeTimers()
    closeConnection.mockClear()
    closeAllConnections.mockClear()
    installRuntime({
      connectionsStream: stream,
      api: () => ({ closeConnection, closeAllConnections }),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits on reset and update messages, and on the idle timer otherwise', () => {
    const source = singboxApiDriver.connections.subscribe()

    stream.emit(
      events({
        reset: true,
        events: [{ type: NEW, id: 'a', connection: pbConnection({ id: 'a' }) }],
      }),
    )
    expect(ids(source.data.value?.connections ?? [])).toEqual(['a'])

    const before = source.data.value
    stream.emit(events({ events: [{ type: NEW, id: 'b', connection: pbConnection({ id: 'b' }) }] }))
    expect(source.data.value).toBe(before)

    vi.advanceTimersByTime(1500)
    expect(ids(source.data.value?.connections ?? [])).toEqual(['a', 'b'])

    stream.emit(events({ events: [{ type: UPDATE, id: 'a', downlinkDelta: 100n }] }))
    const [a] = source.data.value?.connections as SingboxConnectionRawMessage[]
    expect(a.downlinkTotal).toBe(100)

    source.close()
    expect(stream.size()).toBe(0)
  })

  it('closes one or all connections and leaves filtered closes to the Clash path', async () => {
    const clashDisconnectAll = vi
      .spyOn(singboxDriver.connections, 'disconnectAll')
      .mockResolvedValue()

    await singboxApiDriver.connections.disconnect('a')
    expect(closeConnection).toHaveBeenCalledWith({ id: 'a' })

    await singboxApiDriver.connections.disconnectAll()
    expect(closeAllConnections).toHaveBeenCalledOnce()
    expect(clashDisconnectAll).not.toHaveBeenCalled()

    closeConnection.mockClear()
    await singboxApiDriver.connections.disconnectAll({ type: 'udp' })
    expect(clashDisconnectAll).toHaveBeenCalledWith({ type: 'udp' })
    expect(closeConnection).not.toHaveBeenCalled()
    expect(closeAllConnections).toHaveBeenCalledOnce()

    clashDisconnectAll.mockRestore()
  })
})
