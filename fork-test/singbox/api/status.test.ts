import { singboxApiDriver } from '@/assembly/driver/singbox-api'
import { StatusSchema, type Status } from '@/assembly/singbox/api/gen/daemon/started_service_pb'
import { singboxRuntime } from '@/assembly/singbox/api/state'
import { formatUptime, toMemorySample, toRuntime, toTrafficSample } from '@/assembly/singbox/status'
import { create } from '@bufbuild/protobuf'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeShared, installRuntime } from './fake-runtime'

const status = create(StatusSchema, {
  memory: 1024n,
  goroutines: 12,
  connectionsIn: 3,
  connectionsOut: 4,
  uplink: 10n,
  downlink: 20n,
  uplinkTotal: 100n,
  downlinkTotal: 200n,
})

describe('status mapping', () => {
  it('maps traffic, memory and runtime', () => {
    expect(toTrafficSample(status)).toEqual({ down: 20, up: 10, downTotal: 200, upTotal: 100 })
    expect(toMemorySample(status)).toEqual({ inuse: 1024 })
    expect(
      toRuntime(status, { startedAt: 5, goroutines: 0, connectionsIn: 0, connectionsOut: 0 }),
    ).toEqual({ startedAt: 5, goroutines: 12, connectionsIn: 3, connectionsOut: 4 })
    expect(toRuntime(status).startedAt).toBe(0)
  })
})

describe('singboxApiDriver.metrics', () => {
  const stream = fakeShared<Status>()

  beforeEach(() => {
    installRuntime({ statusStream: stream })
    singboxRuntime.value = { startedAt: 7, goroutines: 0, connectionsIn: 0, connectionsOut: 0 }
  })

  it('shares one status stream for traffic and memory', () => {
    const traffic = singboxApiDriver.metrics.traffic()
    const memory = singboxApiDriver.metrics.memory()

    expect(stream.size()).toBe(2)
    stream.emit(status)

    expect(traffic.data.value).toEqual({ down: 20, up: 10, downTotal: 200, upTotal: 100 })
    expect(memory.data.value).toEqual({ inuse: 1024 })
    expect(singboxRuntime.value).toEqual({
      startedAt: 7,
      goroutines: 12,
      connectionsIn: 3,
      connectionsOut: 4,
    })

    traffic.close()
    memory.close()
    expect(stream.size()).toBe(0)
  })
})

describe('singboxApiDriver.metrics.traffic startedAt refresh', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refetches startedAt only after a gap of more than 5s between status messages', async () => {
    const stream = fakeShared<Status>()
    const getStartedAt = vi.fn().mockResolvedValue({ startedAt: 999n })

    installRuntime({ statusStream: stream, api: () => ({ getStartedAt }) })
    singboxRuntime.value = { startedAt: 1, goroutines: 0, connectionsIn: 0, connectionsOut: 0 }

    const nowSpy = vi.spyOn(Date, 'now')

    nowSpy.mockReturnValue(0)
    const traffic = singboxApiDriver.metrics.traffic()
    stream.emit(status)
    expect(getStartedAt).not.toHaveBeenCalled()

    nowSpy.mockReturnValue(2000)
    stream.emit(status)
    expect(getStartedAt).not.toHaveBeenCalled()
    expect(singboxRuntime.value?.startedAt).toBe(1)

    nowSpy.mockReturnValue(8000)
    stream.emit(status)
    await vi.waitFor(() => expect(getStartedAt).toHaveBeenCalledTimes(1))
    expect(singboxRuntime.value?.startedAt).toBe(999)

    traffic.close()
  })

  it('ignores a failed startedAt refetch', async () => {
    const stream = fakeShared<Status>()
    const getStartedAt = vi.fn().mockRejectedValue(new Error('boom'))

    installRuntime({ statusStream: stream, api: () => ({ getStartedAt }) })
    singboxRuntime.value = { startedAt: 1, goroutines: 0, connectionsIn: 0, connectionsOut: 0 }

    const nowSpy = vi.spyOn(Date, 'now')

    nowSpy.mockReturnValue(0)
    const traffic = singboxApiDriver.metrics.traffic()
    stream.emit(status)

    nowSpy.mockReturnValue(8000)
    stream.emit(status)
    await vi.waitFor(() => expect(getStartedAt).toHaveBeenCalledTimes(1))
    expect(singboxRuntime.value?.startedAt).toBe(1)

    traffic.close()
  })
})

describe('formatUptime', () => {
  it('formats short and long durations', () => {
    expect(formatUptime(0)).toBe('00:00:00')
    expect(formatUptime(3_723_000)).toBe('01:02:03')
    expect(formatUptime(90_061_000)).toBe('1d 1h 1m')
    expect(formatUptime(-5)).toBe('00:00:00')
  })
})
