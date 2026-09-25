import { singboxApiStatus } from '@/assembly/singbox/api-status'
import { toApiError } from '@/assembly/singbox/api/client'
import {
  fallBackToClash,
  onSingboxApiRestart,
  PROBE_RETRY_MS,
  probeSingboxApi,
} from '@/assembly/singbox/api/probe'
import * as runtime from '@/assembly/singbox/api/runtime'
import {
  resetSingboxApi,
  singboxApi,
  singboxApiError,
  singboxApiModule,
  singboxRuntime,
} from '@/assembly/singbox/api/state'
import { singboxVariant } from '@/assembly/singbox/variant'
import { activeBackend, backendList, setActiveBackend } from '@/store/setup'
import { Code, ConnectError } from '@connectrpc/connect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('@/assembly/singbox/api/runtime', async () => {
  const { ref, shallowRef } = await import('vue')
  const idle = () => ({ phase: ref('idle'), error: shallowRef() })

  return {
    probe: vi.fn(),
    statusStream: idle(),
    connectionsStream: idle(),
    logStream: idle(),
    groupsStream: idle(),
    clashModeStream: idle(),
  }
})

const backend = {
  type: 'clash' as const,
  protocol: 'http',
  host: '127.0.0.1',
  port: '9090',
  secondaryPath: '',
  password: 'pw',
  uuid: 'a',
}
const other = { ...backend, uuid: 'b', port: '9091' }
const subpath = { ...backend, uuid: 'c', secondaryPath: '/ui' }
const info = { version: '1.15.0-moonfruit', apiVersion: 5 }
const restart = vi.fn()

onSingboxApiRestart(restart)

beforeEach(async () => {
  restart.mockReset()
  backendList.value = [backend, other, subpath]
  setActiveBackend(other.uuid)
  vi.mocked(runtime.probe).mockReset()
  vi.mocked(runtime.probe).mockResolvedValueOnce({ ok: false, error: 'unauthorized' })
  await probeSingboxApi(other)
  setActiveBackend(backend.uuid)
  resetSingboxApi()
  singboxApiModule.value = undefined
  singboxVariant.value = 'moonfruit'
  vi.mocked(runtime.probe).mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('toApiError', () => {
  it('maps connect codes', () => {
    expect(toApiError(new ConnectError('', Code.Unauthenticated))).toBe('unauthorized')
    expect(toApiError(new ConnectError('', Code.PermissionDenied))).toBe('unauthorized')
    expect(toApiError(new ConnectError('', Code.Unimplemented))).toBe('unimplemented')
    expect(toApiError(new ConnectError('', Code.NotFound))).toBe('unimplemented')
    expect(toApiError(new ConnectError('', Code.DeadlineExceeded))).toBe('timeout')
    expect(toApiError(new ConnectError('', Code.Unavailable))).toBe('network')
    expect(toApiError(new Error('x'))).toBe('network')
  })
})

describe('probeSingboxApi', () => {
  it('stores api info, runtime module and start time', async () => {
    vi.mocked(runtime.probe).mockResolvedValue({ ok: true, info, startedAt: 1000 })

    await probeSingboxApi(backend)

    expect(runtime.probe).toHaveBeenCalledWith({ baseUrl: 'http://127.0.0.1:9090', secret: 'pw' })
    expect(singboxApi.value).toEqual(info)
    expect(singboxApiModule.value).toBeDefined()
    expect(singboxRuntime.value?.startedAt).toBe(1000)
    expect(singboxApiStatus.value).toEqual({ state: 'connected', apiVersion: 5 })
  })

  it('records the failure reason and keeps the Clash path', async () => {
    vi.mocked(runtime.probe).mockResolvedValue({ ok: false, error: 'unauthorized' })

    await probeSingboxApi(backend)

    expect(singboxApi.value).toBeUndefined()
    expect(singboxApiError.value).toBe('unauthorized')
    expect(singboxApiStatus.value).toEqual({ state: 'failed', reason: 'unauthorized' })
  })

  it('never throws', async () => {
    vi.mocked(runtime.probe).mockRejectedValue(new Error('boom'))

    await expect(probeSingboxApi(backend)).resolves.toBeUndefined()
    expect(singboxApiError.value).toBe('network')
  })

  it('drops a result that arrives after the backend changed', async () => {
    let resolve: (value: Awaited<ReturnType<typeof runtime.probe>>) => void = () => {}
    vi.mocked(runtime.probe).mockReturnValue(new Promise((r) => (resolve = r)))

    const pending = probeSingboxApi(backend)
    await vi.waitFor(() => expect(runtime.probe).toHaveBeenCalled())
    setActiveBackend(other.uuid)
    resolve({ ok: true, info, startedAt: 1 })
    await pending

    expect(singboxApi.value).toBeUndefined()
    expect(singboxApiError.value).toBeUndefined()
  })
})

describe('probe guards', () => {
  it('skips probing a backend behind a sub-path', async () => {
    setActiveBackend(subpath.uuid)
    await probeSingboxApi(subpath)

    expect(runtime.probe).not.toHaveBeenCalled()
    expect(singboxApiError.value).toBe('subpath')
    expect(singboxApiStatus.value).toEqual({ state: 'failed', reason: 'subpath' })
  })

  it('drops a result when a newer probe started for the same backend', async () => {
    let resolve: (value: Awaited<ReturnType<typeof runtime.probe>>) => void = () => {}
    vi.mocked(runtime.probe)
      .mockReturnValueOnce(new Promise((r) => (resolve = r)))
      .mockResolvedValueOnce({ ok: false, error: 'unauthorized' })

    const older = probeSingboxApi(backend)
    await vi.waitFor(() => expect(runtime.probe).toHaveBeenCalledOnce())
    await probeSingboxApi(backend)
    resolve({ ok: true, info, startedAt: 1 })
    await older

    expect(singboxApi.value).toBeUndefined()
    expect(singboxApiError.value).toBe('unauthorized')
  })
})

describe('probe retry', () => {
  it('retries a network failure once and restarts the session on success', async () => {
    vi.useFakeTimers()
    vi.mocked(runtime.probe)
      .mockResolvedValueOnce({ ok: false, error: 'timeout' })
      .mockResolvedValueOnce({ ok: true, info, startedAt: 7 })
      .mockResolvedValue({ ok: false, error: 'unauthorized' })
    restart.mockImplementation(() => {
      resetSingboxApi()
      return probeSingboxApi(backend)
    })

    await probeSingboxApi(backend)
    expect(singboxApiError.value).toBe('timeout')
    await vi.advanceTimersByTimeAsync(PROBE_RETRY_MS - 1)
    expect(runtime.probe).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)

    expect(restart).toHaveBeenCalledOnce()
    expect(runtime.probe).toHaveBeenCalledTimes(2)
    expect(singboxApi.value).toEqual(info)
    expect(singboxApiError.value).toBeUndefined()
    expect(singboxRuntime.value?.startedAt).toBe(7)

    await probeSingboxApi(backend)
    expect(runtime.probe).toHaveBeenCalledTimes(3)
  })

  it('forgets the retry result when the restarted session never probes the API', async () => {
    vi.useFakeTimers()
    vi.mocked(runtime.probe)
      .mockResolvedValueOnce({ ok: false, error: 'network' })
      .mockResolvedValueOnce({ ok: true, info, startedAt: 7 })
      .mockResolvedValue({ ok: false, error: 'unauthorized' })
    restart.mockImplementation(() => resetSingboxApi())

    await probeSingboxApi(backend)
    await vi.advanceTimersByTimeAsync(PROBE_RETRY_MS)
    expect(restart).toHaveBeenCalledOnce()
    expect(singboxApi.value).toBeUndefined()

    await probeSingboxApi(backend)
    expect(runtime.probe).toHaveBeenCalledTimes(3)
    expect(singboxApiError.value).toBe('unauthorized')
  })

  it('retries only once', async () => {
    vi.useFakeTimers()
    vi.mocked(runtime.probe).mockResolvedValue({ ok: false, error: 'network' })

    await probeSingboxApi(backend)
    await vi.advanceTimersByTimeAsync(PROBE_RETRY_MS * 5)

    expect(runtime.probe).toHaveBeenCalledTimes(2)
    expect(restart).not.toHaveBeenCalled()
  })

  it('does not retry other failures', async () => {
    vi.useFakeTimers()
    vi.mocked(runtime.probe).mockResolvedValue({ ok: false, error: 'unauthorized' })

    await probeSingboxApi(backend)
    await vi.advanceTimersByTimeAsync(PROBE_RETRY_MS * 2)

    expect(runtime.probe).toHaveBeenCalledOnce()
  })

  it('skips the retry after the backend changed or a newer probe started', async () => {
    vi.useFakeTimers()
    vi.mocked(runtime.probe).mockResolvedValue({ ok: false, error: 'timeout' })

    await probeSingboxApi(backend)
    setActiveBackend(other.uuid)
    await vi.advanceTimersByTimeAsync(PROBE_RETRY_MS)
    expect(runtime.probe).toHaveBeenCalledOnce()

    setActiveBackend(backend.uuid)
    await probeSingboxApi(backend)
    vi.mocked(runtime.probe).mockClear()
    await probeSingboxApi(backend)
    await vi.advanceTimersByTimeAsync(PROBE_RETRY_MS)
    expect(runtime.probe).toHaveBeenCalledTimes(2)
  })
})

describe('fallBackToClash', () => {
  it('restarts the session on unauthorized and probes again', async () => {
    vi.mocked(runtime.probe).mockResolvedValue({ ok: true, info, startedAt: 1 })
    await probeSingboxApi(backend)

    fallBackToClash('unauthorized')

    expect(singboxApi.value).toBeUndefined()
    expect(singboxApiError.value).toBe('unauthorized')
    expect(restart).toHaveBeenCalledOnce()

    resetSingboxApi()
    await probeSingboxApi(backend)
    expect(runtime.probe).toHaveBeenCalledTimes(2)
    expect(singboxApi.value).toEqual(info)
  })

  it('keeps other terminal errors off the API path until the backend changes', async () => {
    vi.mocked(runtime.probe).mockResolvedValue({ ok: true, info, startedAt: 1 })
    await probeSingboxApi(backend)

    fallBackToClash('unimplemented')

    expect(singboxApi.value).toBeUndefined()
    expect(restart).toHaveBeenCalledOnce()

    resetSingboxApi()
    await probeSingboxApi(backend)
    expect(runtime.probe).toHaveBeenCalledOnce()
    expect(singboxApiStatus.value).toEqual({ state: 'failed', reason: 'unimplemented' })

    setActiveBackend(other.uuid)
    await nextTick()
    setActiveBackend(backend.uuid)
    await nextTick()
    await probeSingboxApi(backend)
    expect(runtime.probe).toHaveBeenCalledTimes(2)
    expect(singboxApi.value).toEqual(info)
  })

  it('probes again after the same backend is edited', async () => {
    vi.mocked(runtime.probe).mockResolvedValue({ ok: true, info, startedAt: 1 })
    await probeSingboxApi(backend)
    fallBackToClash('unimplemented')

    backendList.value = [{ ...backend, password: 'new' }, other, subpath]
    await nextTick()
    await probeSingboxApi(activeBackend.value!)
    expect(runtime.probe).toHaveBeenCalledTimes(2)
    expect(singboxApi.value).toEqual(info)
  })
})

describe('singboxApiStatus', () => {
  it('is hidden outside moonfruit', () => {
    singboxApi.value = info
    singboxVariant.value = 'refind'
    expect(singboxApiStatus.value).toBeUndefined()

    singboxVariant.value = 'moonfruit'
    expect(singboxApiStatus.value).toEqual({ state: 'connected', apiVersion: 5 })
  })
})
