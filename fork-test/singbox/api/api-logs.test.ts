import { singboxApiDriver } from '@/assembly/driver/singbox-api'
import { parseAnsi } from '@/assembly/singbox/ansi'
import { dedupeBacklog, passesLevel, toLog, toLogLevel } from '@/assembly/singbox/api-logs'
import {
  LogLevel,
  LogSchema,
  type Log as PbLog,
} from '@/assembly/singbox/api/gen/daemon/started_service_pb'
import { singboxRuntime } from '@/assembly/singbox/api/state'
import { withReset } from '@/assembly/singbox/logs'
import { LOG_LEVEL } from '@/constant'
import type { Log } from '@/types'
import { create } from '@bufbuild/protobuf'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeShared, installRuntime } from './fake-runtime'

vi.mock('@/assembly/singbox/ansi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/assembly/singbox/ansi')>()

  return { ...actual, parseAnsi: vi.fn(actual.parseAnsi) }
})

const ESC = String.fromCharCode(27)
const FIRST = { firstOfConnection: true }

describe('levels', () => {
  it('maps every sing-box level', () => {
    expect(toLogLevel(LogLevel.PANIC)).toBe(LOG_LEVEL.Panic)
    expect(toLogLevel(LogLevel.FATAL)).toBe(LOG_LEVEL.Fatal)
    expect(toLogLevel(LogLevel.ERROR)).toBe(LOG_LEVEL.Error)
    expect(toLogLevel(LogLevel.WARN)).toBe(LOG_LEVEL.Warning)
    expect(toLogLevel(LogLevel.INFO)).toBe(LOG_LEVEL.Info)
    expect(toLogLevel(LogLevel.DEBUG)).toBe(LOG_LEVEL.Debug)
    expect(toLogLevel(LogLevel.TRACE)).toBe(LOG_LEVEL.Trace)
  })

  it('filters by minimum severity', () => {
    expect(passesLevel(LOG_LEVEL.Info, LOG_LEVEL.Info)).toBe(true)
    expect(passesLevel(LOG_LEVEL.Debug, LOG_LEVEL.Info)).toBe(false)
    expect(passesLevel(LOG_LEVEL.Panic, LOG_LEVEL.Warning)).toBe(true)
    expect(passesLevel(LOG_LEVEL.Trace, LOG_LEVEL.Trace)).toBe(true)
    expect(passesLevel(LOG_LEVEL.Error, LOG_LEVEL.Silent)).toBe(false)
  })
})

describe('toLog', () => {
  it('strips the level prefix and keeps colors', () => {
    const log = toLog({
      level: LogLevel.INFO,
      message: `${ESC}[36mINFO${ESC}[0m[0012] [${ESC}[38;5;208m123 5ms${ESC}[0m] dns: ok`,
    })

    expect(log.type).toBe(LOG_LEVEL.Info)
    expect(log.payload).toBe('[123 5ms] dns: ok')
    expect(log.ansi?.map((segment) => segment.text).join('')).toBe(log.payload)
    expect(log.ansi?.some((segment) => segment.fg === '#ff8700')).toBe(true)
  })

  it('leaves messages without prefix untouched', () => {
    expect(toLog({ level: LogLevel.WARN, message: 'plain text' }).payload).toBe('plain text')
  })
})

describe('dedupeBacklog', () => {
  it('returns only lines after the delivered tail', () => {
    expect(dedupeBacklog(['a', 'b', 'c'], ['a', 'b', 'c', 'd', 'e'])).toEqual(['d', 'e'])
    expect(dedupeBacklog(['x', 'b', 'c'], ['b', 'c', 'd'])).toEqual(['d'])
  })

  it('returns everything without an overlap', () => {
    expect(dedupeBacklog(['a'], ['p', 'q'])).toEqual(['p', 'q'])
    expect(dedupeBacklog([], ['p'])).toEqual(['p'])
  })

  it('returns nothing when the backlog is fully delivered', () => {
    expect(dedupeBacklog(['a', 'b'], ['a', 'b'])).toEqual([])
  })
})

describe('singboxApiDriver.logs', () => {
  const stream = fakeShared<PbLog>()
  const message = (level: LogLevel, text: string) => ({ level, message: `INFO[0001] ${text}` })

  beforeEach(() => {
    installRuntime({ logStream: stream })
  })

  it('delivers the backlog once, filters by level and dedupes after reconnect', () => {
    const batches: Log[][] = []
    const subscription = singboxApiDriver.logs.subscribe(LOG_LEVEL.Info, (batch) =>
      batches.push(batch),
    )

    stream.emit(
      create(LogSchema, {
        reset: true,
        messages: [message(LogLevel.INFO, 'a'), message(LogLevel.DEBUG, 'b')],
      }),
      FIRST,
    )
    stream.emit(create(LogSchema, { messages: [message(LogLevel.ERROR, 'c')] }))
    stream.emit(
      create(LogSchema, {
        reset: true,
        messages: [
          message(LogLevel.INFO, 'a'),
          message(LogLevel.DEBUG, 'b'),
          message(LogLevel.ERROR, 'c'),
          message(LogLevel.INFO, 'd'),
        ],
      }),
      FIRST,
    )

    expect(batches.map((batch) => batch.map((log) => log.payload))).toEqual([['a'], ['c'], ['d']])

    subscription.close()
    expect(stream.size()).toBe(0)
  })

  it('reports a server-side clear as a reset and forgets the delivered window', () => {
    const batches: string[][] = []
    let resets = 0
    const subscription = singboxApiDriver.logs.subscribe(
      LOG_LEVEL.Info,
      (batch) => batches.push(batch.map((log) => log.payload)),
      () => resets++,
    )

    stream.emit(create(LogSchema, { reset: true, messages: [] }), FIRST)
    expect(resets).toBe(0)

    stream.emit(create(LogSchema, { messages: [message(LogLevel.INFO, 'a')] }))
    stream.emit(create(LogSchema, { reset: true, messages: [] }))
    expect(resets).toBe(1)

    stream.emit(create(LogSchema, { reset: true, messages: [message(LogLevel.INFO, 'a')] }), FIRST)
    expect(batches).toEqual([['a'], ['a']])

    subscription.close()
  })

  it('forwards the reset callback through withReset', () => {
    let resets = 0
    const subscription = withReset(singboxApiDriver.logs, () => resets++).subscribe(
      LOG_LEVEL.Info,
      () => {},
    )

    stream.emit(create(LogSchema, { reset: true, messages: [message(LogLevel.INFO, 'a')] }), FIRST)
    stream.emit(create(LogSchema, { reset: true, messages: [] }))
    expect(resets).toBe(1)

    subscription.close()
  })

  it('treats a reset with lines mid-connection as a clear followed by fresh lines', () => {
    const batches: string[][] = []
    let resets = 0
    const subscription = singboxApiDriver.logs.subscribe(
      LOG_LEVEL.Info,
      (batch) => batches.push(batch.map((log) => log.payload)),
      () => resets++,
    )

    stream.emit(create(LogSchema, { reset: true, messages: [message(LogLevel.INFO, 'a')] }), FIRST)
    stream.emit(create(LogSchema, { reset: true, messages: [message(LogLevel.INFO, 'a')] }))
    expect(resets).toBe(1)
    expect(batches).toEqual([['a'], ['a']])

    stream.emit(
      create(LogSchema, {
        reset: true,
        messages: [message(LogLevel.INFO, 'a'), message(LogLevel.INFO, 'b')],
      }),
      FIRST,
    )
    expect(resets).toBe(1)
    expect(batches).toEqual([['a'], ['a'], ['b']])

    subscription.close()
  })

  it('does not parse lines filtered out by level', () => {
    const subscription = singboxApiDriver.logs.subscribe(LOG_LEVEL.Warning, () => {})

    vi.mocked(parseAnsi).mockClear()
    stream.emit(
      create(LogSchema, {
        reset: true,
        messages: [
          message(LogLevel.DEBUG, 'a'),
          message(LogLevel.INFO, 'b'),
          message(LogLevel.ERROR, 'c'),
        ],
      }),
      FIRST,
    )
    expect(parseAnsi).toHaveBeenCalledTimes(1)

    subscription.close()
  })

  it('dates backlog lines from the start time and live lines on receipt', () => {
    const batches: Log[][] = []
    const subscription = singboxApiDriver.logs.subscribe(LOG_LEVEL.Info, (batch) =>
      batches.push(batch),
    )

    singboxRuntime.value = {
      startedAt: 1_000_000,
      goroutines: 0,
      connectionsIn: 0,
      connectionsOut: 0,
    }
    stream.emit(
      create(LogSchema, {
        reset: true,
        messages: [{ level: LogLevel.INFO, message: 'INFO[0012] a' }],
      }),
      FIRST,
    )
    stream.emit(
      create(LogSchema, { messages: [{ level: LogLevel.INFO, message: 'INFO[0013] b' }] }),
    )

    expect(batches.map((batch) => batch.map((log) => log.timestamp))).toEqual([
      [1_012_000],
      [undefined],
    ])

    singboxRuntime.value = undefined
    subscription.close()
  })
})

describe('toLog timestamps', () => {
  it('computes the time from the relative prefix and a base', () => {
    expect(toLog({ level: LogLevel.INFO, message: 'INFO[0012] x' }, 1_000_000).timestamp).toBe(
      1_012_000,
    )
    expect(
      toLog({ level: LogLevel.INFO, message: `${ESC}[36mINFO${ESC}[0m[0003] x` }, 1_000_000)
        .timestamp,
    ).toBe(1_003_000)
  })

  it('leaves the time unset without a base or a prefix', () => {
    expect(toLog({ level: LogLevel.INFO, message: 'INFO[0012] x' }).timestamp).toBeUndefined()
    expect(toLog({ level: LogLevel.INFO, message: 'INFO[0012] x' }, 0).timestamp).toBeUndefined()
    expect(toLog({ level: LogLevel.INFO, message: 'INFO x' }, 1000).timestamp).toBeUndefined()
    expect(toLog({ level: LogLevel.INFO, message: 'plain' }, 1000).timestamp).toBeUndefined()
  })
})
