import { Code, ConnectError } from '@connectrpc/connect'
import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'

export type StreamPhase = 'idle' | 'connecting' | 'active' | 'error'

export type StreamMeta = { firstOfConnection: boolean }

export type SharedStream<T> = {
  subscribe(listener: (value: T, meta: StreamMeta) => void): () => void
  retryNow(): void
  phase: Ref<StreamPhase>
  error: ShallowRef<unknown>
}

export type SharedStreamOptions = {
  onTerminal?: (error: unknown) => void
  idleTimeoutMs?: number
}

const TERMINAL_CODES = new Set([Code.Unauthenticated, Code.PermissionDenied, Code.Unimplemented])
const streams = new Set<{ retryNow(): void }>()

export const backoffDelay = (attempt: number) => Math.min(1000 * attempt, 5000)

export const isTerminal = (error: unknown) =>
  error instanceof ConnectError && TERMINAL_CODES.has(error.code)

export const retryAllStreams = () => streams.forEach((stream) => stream.retryNow())

export const createSharedStream = <T>(
  open: (signal: AbortSignal) => AsyncIterable<T>,
  options: SharedStreamOptions = {},
): SharedStream<T> => {
  const listeners = new Set<(value: T, meta: StreamMeta) => void>()
  const phase = ref<StreamPhase>('idle')
  const error = shallowRef<unknown>()
  let controller: AbortController | undefined
  let connection: { abort: (reason: 'idle' | 'retry') => void } | undefined
  let skipWait: (() => void) | undefined
  let lastMessageAt = 0

  const wait = (signal: AbortSignal, ms: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', done)
        skipWait = undefined
        resolve()
      }
      const timer = setTimeout(done, ms)

      skipWait = done
      signal.addEventListener('abort', done, { once: true })
    })

  const connect = async (signal: AbortSignal) => {
    const child = new AbortController()
    const onAbort = () => child.abort()
    let reason: 'idle' | 'retry' | undefined
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let first = true

    const abort = (why: 'idle' | 'retry') => {
      reason ??= why
      child.abort()
    }
    const arm = () => {
      if (!options.idleTimeoutMs) return
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => abort('idle'), options.idleTimeoutMs)
    }

    const handle = { abort }

    signal.addEventListener('abort', onAbort, { once: true })
    connection = handle
    lastMessageAt = Date.now()
    arm()

    try {
      for await (const value of open(child.signal)) {
        if (child.signal.aborted) break
        lastMessageAt = Date.now()
        arm()
        phase.value = 'active'
        error.value = undefined
        listeners.forEach((listener) => listener(value, { firstOfConnection: first }))
        first = false
      }
    } catch (e) {
      if (!child.signal.aborted) return { error: e, received: !first }
    } finally {
      clearTimeout(idleTimer)
      signal.removeEventListener('abort', onAbort)
      if (connection === handle) connection = undefined
    }

    if (reason === 'idle') {
      return {
        error: new ConnectError('stream idle timeout', Code.DeadlineExceeded),
        received: !first,
      }
    }

    return { retry: reason === 'retry', received: !first }
  }

  const run = async (signal: AbortSignal) => {
    let attempt = 0

    while (!signal.aborted) {
      phase.value = 'connecting'

      const result = await connect(signal)

      if (signal.aborted) return
      if (result.received) attempt = 0
      if ('error' in result) {
        error.value = result.error
        if (isTerminal(result.error)) {
          phase.value = 'error'
          options.onTerminal?.(result.error)
          return
        }
      }
      if ('retry' in result && result.retry) continue

      phase.value = 'connecting'
      attempt += 1
      await wait(signal, backoffDelay(attempt))
    }
  }

  const stop = () => {
    controller?.abort()
    controller = undefined
    phase.value = 'idle'
    error.value = undefined
  }

  const stream: SharedStream<T> = {
    phase,
    error,
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) {
        controller = new AbortController()
        void run(controller.signal)
      }

      return () => {
        if (!listeners.delete(listener)) return
        if (listeners.size === 0) stop()
      }
    },
    retryNow() {
      if (skipWait) {
        skipWait()
        return
      }
      if (!options.idleTimeoutMs || !connection) return
      if (Date.now() - lastMessageAt > options.idleTimeoutMs) connection.abort('retry')
    },
  }

  streams.add(stream)
  return stream
}
