import { core, Core } from '@/assembly/backend'
import { queryDNS } from '@/assembly/config'
import { createEarthDNSResolver } from '@/assembly/overview-fork/earth-dns'
import { activeBackend } from '@/store/setup'
import type { Backend, DNSQuery } from '@/types'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Ref } from 'vue'

vi.mock('@/assembly/backend', async () => ({
  Core: { Singbox: 'singbox', Mihomo: 'mihomo' },
  core: (await import('vue')).ref('singbox'),
}))
vi.mock('@/assembly/config', () => ({ queryDNS: vi.fn() }))
vi.mock('@/store/setup', async () => ({ activeBackend: (await import('vue')).ref() }))

let resolver: ReturnType<typeof createEarthDNSResolver>
const backend = activeBackend as Ref<Backend | undefined>
const answer = { SkipFakeIP: true, Answer: [{ type: 1, data: '1.1.1.1', TTL: 1 }] } as DNSQuery

beforeEach(() => {
  core.value = Core.Singbox
  backend.value = {
    type: 'clash',
    protocol: 'http',
    host: '127.0.0.1',
    port: '9999',
    secondaryPath: '',
    password: '',
    uuid: 'a',
  }
  vi.mocked(queryDNS).mockReset().mockResolvedValue(answer)
  resolver = createEarthDNSResolver()
})
afterEach(() => resolver.dispose())

it('requests skipFakeIP for sing-box and leaves Mihomo queries unchanged', async () => {
  await resolver.resolve(['example.com'])
  expect(queryDNS).toHaveBeenLastCalledWith(
    { name: 'example.com', type: 'A', skipFakeIP: true },
    expect.any(AbortSignal),
  )
  core.value = Core.Mihomo
  await resolver.resolve(['example.com'])
  expect(queryDNS).toHaveBeenLastCalledWith(
    { name: 'example.com', type: 'A' },
    expect.any(AbortSignal),
  )
})

it('isolates the DNS cache when switching backends', async () => {
  await resolver.resolve(['example.com'])
  const signal = vi.mocked(queryDNS).mock.calls[0]![1]!
  backend.value = { ...backend.value!, uuid: 'b' }
  expect(signal.aborted).toBe(true)
  await resolver.resolve(['example.com'])
  expect(queryDNS).toHaveBeenCalledTimes(2)
})

it('resets and cancels when editing the current backend address', async () => {
  await resolver.resolve(['example.com'])
  const signal = vi.mocked(queryDNS).mock.calls[0]![1]!
  activeBackend.value!.port = '10000'
  expect(signal.aborted).toBe(true)
  await resolver.resolve(['example.com'])
  expect(queryDNS).toHaveBeenCalledTimes(2)
})

it('stops resolving after disposal', async () => {
  resolver.dispose()
  await resolver.resolve(['example.com'])
  expect(queryDNS).not.toHaveBeenCalled()
})
