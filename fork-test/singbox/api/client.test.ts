import { probe, serverStream, type StartedServiceClient } from '@/assembly/singbox/api/client'
import { StartedService } from '@/assembly/singbox/api/gen/daemon/started_service_pb'
import { wsServerStream } from '@/assembly/singbox/api/websocket'
import { language } from '@/store/settings'
import { backendList, setActiveBackend } from '@/store/setup'
import { createClient } from '@connectrpc/connect'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@connectrpc/connect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@connectrpc/connect')>()

  return { ...actual, createClient: vi.fn() }
})
vi.mock('@connectrpc/connect-web', () => ({ createGrpcWebTransport: vi.fn() }))
vi.mock('@/assembly/singbox/api/websocket', () => ({ wsServerStream: vi.fn() }))

const mockedCreateClient = createClient as unknown as Mock

const endpoint = { baseUrl: 'http://127.0.0.1:9090', secret: '' }

beforeEach(() => {
  mockedCreateClient.mockReset()
})

describe('probe', () => {
  it('uses 0 as startedAt when GetStartedAt fails', async () => {
    mockedCreateClient.mockReturnValue({
      getVersion: vi.fn().mockResolvedValue({ version: '1.15.0-moonfruit', apiVersion: 5 }),
      getStartedAt: vi.fn().mockRejectedValue(new Error('unimplemented')),
    } satisfies Partial<StartedServiceClient>)

    const result = await probe(endpoint)

    expect(result).toEqual({
      ok: true,
      info: { version: '1.15.0-moonfruit', apiVersion: 5 },
      startedAt: 0,
    })
  })

  it('uses the returned startedAt when GetStartedAt succeeds', async () => {
    mockedCreateClient.mockReturnValue({
      getVersion: vi.fn().mockResolvedValue({ version: 'x', apiVersion: 1 }),
      getStartedAt: vi.fn().mockResolvedValue({ startedAt: 1234n }),
    } satisfies Partial<StartedServiceClient>)

    const result = await probe(endpoint)

    expect(result).toEqual({ ok: true, info: { version: 'x', apiVersion: 1 }, startedAt: 1234 })
  })
})

describe('serverStream', () => {
  it('passes Accept-Language to the websocket transport', () => {
    backendList.value = [
      {
        type: 'clash',
        protocol: 'http',
        host: '127.0.0.1',
        port: '9090',
        secondaryPath: '',
        password: 'pw',
        uuid: 'a',
      },
    ]
    setActiveBackend('a')
    language.value = 'zh' as typeof language.value

    const signal = new AbortController().signal
    serverStream(StartedService.method.subscribeClashMode, {}, signal)

    expect(wsServerStream).toHaveBeenCalledWith(
      { baseUrl: 'http://127.0.0.1:9090', secret: 'pw' },
      StartedService.method.subscribeClashMode,
      {},
      signal,
      { headers: { 'accept-language': 'zh' } },
    )
  })
})
