import { fallBackToClash } from '@/assembly/singbox/api/probe'
import { singboxApi } from '@/assembly/singbox/api/state'
import { backendList, setActiveBackend } from '@/store/setup'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

const pending: (() => void)[] = []

vi.mock('@/assembly/version', () => ({
  probeActiveBackend: vi.fn(() => new Promise<void>((resolve) => pending.push(resolve))),
}))
vi.mock('@/assembly/connections', () => ({ initConnections: vi.fn(), stopConnections: vi.fn() }))
vi.mock('@/assembly/logs', () => ({ initLogs: vi.fn(), stopLogs: vi.fn() }))
vi.mock('@/assembly/overview', () => ({ initSatistic: vi.fn(), stopSatistic: vi.fn() }))
vi.mock('@/assembly/config', () => ({ fetchConfigs: vi.fn() }))
vi.mock('@/assembly/proxies', () => ({ fetchProxies: vi.fn() }))
vi.mock('@/assembly/rules', () => ({ fetchRules: vi.fn() }))
vi.mock('@/assembly/dae', () => ({ fetchDaeRuntime: vi.fn() }))

const backend = (uuid: string, port: string) => ({
  type: 'clash' as const,
  protocol: 'http',
  host: '127.0.0.1',
  port,
  secondaryPath: '',
  password: '',
  uuid,
})

const flush = async () => {
  await nextTick()
  for (let index = 0; index < 5; index++) await Promise.resolve()
}

beforeAll(() => {
  backendList.value = [backend('a', '9090'), backend('b', '9091')]
  setActiveBackend('a')
})

describe('startBackendSession', () => {
  it('drops a session whose backend changed while probing', async () => {
    const { initConnections } = await import('@/assembly/connections')
    const { fetchConfigs } = await import('@/assembly/config')

    await import('@/assembly/session')
    await flush()
    expect(pending).toHaveLength(1)

    setActiveBackend('b')
    await flush()
    expect(pending).toHaveLength(2)

    pending[0]()
    await flush()
    expect(initConnections).not.toHaveBeenCalled()
    expect(fetchConfigs).not.toHaveBeenCalled()

    pending[1]()
    await flush()
    expect(initConnections).toHaveBeenCalledOnce()
    expect(fetchConfigs).toHaveBeenCalledOnce()
  })

  it('drops an older session when the same backend is reassigned', async () => {
    const { initConnections } = await import('@/assembly/connections')

    vi.mocked(initConnections).mockClear()
    backendList.value = [backend('a', '9090'), backend('b', '9092')]
    await flush()
    backendList.value = [backend('a', '9090'), backend('b', '9093')]
    await flush()
    expect(pending).toHaveLength(4)

    pending[2]()
    await flush()
    expect(initConnections).not.toHaveBeenCalled()

    pending[3]()
    await flush()
    expect(initConnections).toHaveBeenCalledOnce()
  })

  it('restarts the session when the API path falls back to Clash', async () => {
    singboxApi.value = { version: 'x', apiVersion: 1 }
    fallBackToClash('unauthorized')
    await flush()

    expect(pending).toHaveLength(5)
    expect(singboxApi.value).toBeUndefined()
  })
})
