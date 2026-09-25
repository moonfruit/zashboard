import {
  backoffDelay,
  createSharedStream,
  isTerminal,
  retryAllStreams,
} from '@/assembly/singbox/api/stream'
import { Code, ConnectError } from '@connectrpc/connect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Session = {
  signal: AbortSignal
  emit: (value: number) => void
  fail: (error: unknown) => void
  end: () => void
}

const harness = () => {
  const sessions: Session[] = []
  const open = (signal: AbortSignal): AsyncIterable<number> => ({
    [Symbol.asyncIterator]() {
      const queue: number[] = []
      let error: unknown
      let done = false
      let wake: (() => void) | undefined
      const poke = () => {
        wake?.()
        wake = undefined
      }

      sessions.push({
        signal,
        emit: (value) => {
          queue.push(value)
          poke()
        },
        fail: (e) => {
          error = e
          poke()
        },
        end: () => {
          done = true
          poke()
        },
      })
      signal.addEventListener('abort', () => {
        done = true
        poke()
      })

      return {
        async next(): Promise<IteratorResult<number>> {
          while (true) {
            if (queue.length) return { value: queue.shift() as number, done: false }
            if (error) throw error
            if (done) return { value: undefined, done: true }
            await new Promise<void>((resolve) => (wake = resolve))
          }
        },
      }
    },
  })

  return { sessions, open }
}

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('helpers', () => {
  it('backs off linearly up to 5s', () => {
    expect([1, 2, 3, 5, 9].map(backoffDelay)).toEqual([1000, 2000, 3000, 5000, 5000])
  })

  it('detects terminal codes', () => {
    expect(isTerminal(new ConnectError('', Code.Unauthenticated))).toBe(true)
    expect(isTerminal(new ConnectError('', Code.PermissionDenied))).toBe(true)
    expect(isTerminal(new ConnectError('', Code.Unimplemented))).toBe(true)
    expect(isTerminal(new ConnectError('', Code.Unavailable))).toBe(false)
    expect(isTerminal(new Error('x'))).toBe(false)
  })
})

describe('createSharedStream', () => {
  it('starts lazily, shares one session and stops with the last subscriber', async () => {
    const h = harness()
    const stream = createSharedStream(h.open)
    const a: number[] = []
    const b: number[] = []

    expect(h.sessions).toHaveLength(0)
    const offA = stream.subscribe((value) => a.push(value))
    const offB = stream.subscribe((value) => b.push(value))
    await tick()
    expect(h.sessions).toHaveLength(1)
    expect(stream.phase.value).toBe('connecting')

    h.sessions[0].emit(1)
    await tick()
    expect(a).toEqual([1])
    expect(b).toEqual([1])
    expect(stream.phase.value).toBe('active')

    offA()
    expect(h.sessions[0].signal.aborted).toBe(false)
    offB()
    expect(h.sessions[0].signal.aborted).toBe(true)
    expect(stream.phase.value).toBe('idle')
  })

  it('reconnects with backoff and resets the attempt after a message', async () => {
    const h = harness()
    const stream = createSharedStream(h.open)

    stream.subscribe(() => {})
    await tick()
    h.sessions[0].fail(new ConnectError('down', Code.Unavailable))
    await tick(999)
    expect(h.sessions).toHaveLength(1)
    await tick(1)
    expect(h.sessions).toHaveLength(2)

    h.sessions[1].end()
    await tick(1999)
    expect(h.sessions).toHaveLength(2)
    await tick(1)
    expect(h.sessions).toHaveLength(3)

    h.sessions[2].emit(1)
    await tick()
    h.sessions[2].fail(new ConnectError('down', Code.Unavailable))
    await tick(1000)
    expect(h.sessions).toHaveLength(4)
  })

  it('stops on terminal codes and reports them', async () => {
    const h = harness()
    const onTerminal = vi.fn()
    const stream = createSharedStream(h.open, { onTerminal })

    stream.subscribe(() => {})
    await tick()
    h.sessions[0].fail(new ConnectError('bad', Code.Unauthenticated))
    await tick(10_000)

    expect(h.sessions).toHaveLength(1)
    expect(stream.phase.value).toBe('error')
    expect(onTerminal).toHaveBeenCalledOnce()
  })

  it('retryNow skips the backoff wait', async () => {
    const h = harness()
    const stream = createSharedStream(h.open)

    stream.subscribe(() => {})
    await tick()
    h.sessions[0].fail(new ConnectError('down', Code.Unavailable))
    await tick()
    stream.retryNow()
    await tick()
    expect(h.sessions).toHaveLength(2)

    h.sessions[1].fail(new ConnectError('down', Code.Unavailable))
    await tick()
    retryAllStreams()
    await tick()
    expect(h.sessions).toHaveLength(3)
  })

  it('does not reconnect after the last subscriber leaves during backoff', async () => {
    const h = harness()
    const stream = createSharedStream(h.open)
    const off = stream.subscribe(() => {})

    await tick()
    h.sessions[0].fail(new ConnectError('down', Code.Unavailable))
    await tick()
    off()
    await tick(10_000)
    expect(h.sessions).toHaveLength(1)
  })

  it('marks the first message of every connection', async () => {
    const h = harness()
    const stream = createSharedStream(h.open)
    const seen: [number, boolean][] = []

    stream.subscribe((value, meta) => seen.push([value, meta.firstOfConnection]))
    await tick()
    h.sessions[0].emit(1)
    h.sessions[0].emit(2)
    await tick()
    h.sessions[0].fail(new ConnectError('down', Code.Unavailable))
    await tick(1000)
    h.sessions[1].emit(3)
    h.sessions[1].emit(4)
    await tick()

    expect(seen).toEqual([
      [1, true],
      [2, false],
      [3, true],
      [4, false],
    ])
  })

  it('reconnects through backoff when no message arrives within the idle timeout', async () => {
    const h = harness()
    const stream = createSharedStream(h.open, { idleTimeoutMs: 5000 })

    stream.subscribe(() => {})
    await tick()
    h.sessions[0].emit(1)
    await tick(4999)
    h.sessions[0].emit(2)
    await tick(4999)
    expect(h.sessions[0].signal.aborted).toBe(false)
    await tick(1)
    expect(h.sessions[0].signal.aborted).toBe(true)
    expect(stream.phase.value).toBe('connecting')
    expect(ConnectError.from(stream.error.value).code).toBe(Code.DeadlineExceeded)
    expect(h.sessions).toHaveLength(1)
    await tick(1000)
    expect(h.sessions).toHaveLength(2)
    expect(h.sessions[1].signal.aborted).toBe(false)
  })

  it('also times out a connection that never delivers a message', async () => {
    const h = harness()
    const stream = createSharedStream(h.open, { idleTimeoutMs: 5000 })

    stream.subscribe(() => {})
    await tick(5000)
    expect(h.sessions[0].signal.aborted).toBe(true)
    await tick(1000)
    expect(h.sessions).toHaveLength(2)
  })

  it('keeps an idle connection without an idle timeout', async () => {
    const h = harness()
    const stream = createSharedStream(h.open)

    stream.subscribe(() => {})
    await tick()
    h.sessions[0].emit(1)
    await tick(60_000)
    expect(h.sessions[0].signal.aborted).toBe(false)
    expect(h.sessions).toHaveLength(1)
  })

  it('retryNow only skips the backoff wait for streams without an idle timeout', async () => {
    const h = harness()
    const stream = createSharedStream(h.open)

    stream.subscribe(() => {})
    await tick()
    h.sessions[0].emit(1)
    vi.setSystemTime(Date.now() + 60_000)
    retryAllStreams()
    await tick()
    expect(h.sessions[0].signal.aborted).toBe(false)
    expect(h.sessions).toHaveLength(1)
  })

  it('retryNow can force a connection opened right after a resubscribe', async () => {
    const h = harness()
    const stream = createSharedStream(h.open, { idleTimeoutMs: 5000 })

    const off = stream.subscribe(() => {})
    off()
    stream.subscribe(() => {})
    await tick()
    expect(h.sessions).toHaveLength(2)

    vi.setSystemTime(Date.now() + 11_000)
    stream.retryNow()
    await tick()
    expect(h.sessions[1].signal.aborted).toBe(true)
    expect(h.sessions).toHaveLength(3)
  })

  it('retryNow uses the idle timeout as the staleness threshold', async () => {
    const h = harness()
    const stream = createSharedStream(h.open, { idleTimeoutMs: 3000 })

    stream.subscribe(() => {})
    await tick()
    h.sessions[0].emit(1)
    await tick(2000)
    stream.retryNow()
    await tick()
    expect(h.sessions[0].signal.aborted).toBe(false)

    vi.setSystemTime(Date.now() + 1001)
    stream.retryNow()
    await tick()
    expect(h.sessions[0].signal.aborted).toBe(true)
    expect(h.sessions).toHaveLength(2)
  })

  it('aborts the connection signal when stopped', async () => {
    const h = harness()
    const stream = createSharedStream(h.open)
    const off = stream.subscribe(() => {})

    await tick()
    off()
    expect(h.sessions[0].signal.aborted).toBe(true)
  })
})
