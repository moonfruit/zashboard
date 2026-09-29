import {
  outboundConnectionsAvailable,
  outboundConnectionsHistory,
  pushOutboundConnections,
  resetOutboundConnections,
} from '@/assembly/overview-fork/connections-out'
import { resetSingboxApi, singboxApi, singboxRuntime } from '@/assembly/singbox/api/state'
import { beforeEach, describe, expect, it } from 'vitest'

const activate = (connectionsOut: number) => {
  singboxApi.value = { version: '1.15.0', apiVersion: 1 }
  singboxRuntime.value = { startedAt: 0, goroutines: 1, connectionsIn: 0, connectionsOut }
}

beforeEach(() => {
  resetSingboxApi()
  resetOutboundConnections()
})

describe('outbound connections history', () => {
  it('is unavailable without the sing-box API', () => {
    expect(outboundConnectionsAvailable.value).toBe(false)
    pushOutboundConnections(1000, 5)
    expect(outboundConnectionsHistory.value).toEqual([])
  })

  it('records connectionsOut at the given timestamp', () => {
    activate(7)
    pushOutboundConnections(1000, 5)
    activate(9)
    pushOutboundConnections(2000, 5)

    expect(outboundConnectionsHistory.value).toEqual([
      { name: 1000, value: [1000, 7] },
      { name: 2000, value: [2000, 9] },
    ])
  })

  it('keeps only the latest points', () => {
    activate(1)
    for (let i = 1; i <= 5; i++) pushOutboundConnections(i * 1000, 3)

    expect(outboundConnectionsHistory.value.map((point) => point.name)).toEqual([3000, 4000, 5000])
  })

  it('clears the history once the API goes away', () => {
    activate(1)
    pushOutboundConnections(1000, 5)
    resetSingboxApi()
    pushOutboundConnections(2000, 5)

    expect(outboundConnectionsHistory.value).toEqual([])
  })
})
