import { createDNSResolver } from '@/assembly/overview-fork/dns-resolver'
import type { DNSQuery } from '@/types'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const answer = (ttl = 0, ip = '1.1.1.1', skip = true) =>
  ({ SkipFakeIP: skip, Answer: [{ type: 1, data: ip, TTL: ttl }] }) as DNSQuery

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

it('deduplicates lookups and caches zero TTL results for five minutes', async () => {
  const query = vi.fn().mockResolvedValue(answer())
  const resolver = createDNSResolver(query, true)
  const [first, second] = await Promise.all([
    resolver.resolve(['example.com', 'example.com']),
    resolver.resolve(['example.com']),
  ])
  expect(first).toEqual({ 'example.com': '1.1.1.1' })
  expect(second).toEqual(first)
  await vi.advanceTimersByTimeAsync(299_999)
  await resolver.resolve(['example.com'])
  expect(query).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  await resolver.resolve(['example.com'])
  expect(query).toHaveBeenCalledTimes(2)
})

it('retains longer DNS TTLs', async () => {
  const query = vi.fn().mockResolvedValue(answer(600))
  const resolver = createDNSResolver(query, true)
  await resolver.resolve(['example.com'])
  await vi.advanceTimersByTimeAsync(300_000)
  await resolver.resolve(['example.com'])
  expect(query).toHaveBeenCalledTimes(1)
})

it('tries AAAA after an unusable A and excludes non-public addresses', async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce(answer(1, '198.18.0.1'))
    .mockResolvedValueOnce({
      SkipFakeIP: true,
      Answer: [{ type: 28, data: '2606:4700:4700::1111', TTL: 1 }],
    })
  const resolver = createDNSResolver(query, true)
  expect(await resolver.resolve(['example.com'])).toEqual({
    'example.com': '2606:4700:4700:0:0:0:0:1111',
  })
  expect(query.mock.calls.map((call) => call[1])).toEqual(['A', 'AAAA'])
})

it('disables old sing-box kernels after one unacknowledged query', async () => {
  const query = vi.fn().mockResolvedValue(answer(0, '198.18.0.1', false))
  const resolver = createDNSResolver(query, true)
  expect(await resolver.resolve(['a.example', 'b.example'])).toEqual({
    'a.example': null,
    'b.example': null,
  })
  await vi.advanceTimersByTimeAsync(600_000)
  await resolver.resolve(['c.example'])
  expect(query).toHaveBeenCalledTimes(1)
})

it('backs off failed lookups from 30 seconds to a maximum of five minutes', async () => {
  const query = vi.fn().mockRejectedValue(new Error('offline'))
  const resolver = createDNSResolver(query, true)
  await resolver.resolve(['example.com'])
  expect(query).toHaveBeenCalledTimes(2)
  for (const [index, delay] of [30_000, 60_000, 120_000, 240_000, 300_000, 300_000].entries()) {
    await vi.advanceTimersByTimeAsync(delay - 1)
    await resolver.resolve(['example.com'])
    expect(query).toHaveBeenCalledTimes((index + 1) * 2)
    await vi.advanceTimersByTimeAsync(1)
    await resolver.resolve(['example.com'])
    expect(query).toHaveBeenCalledTimes((index + 2) * 2)
  }
})

it('stops queued lookups and discards in-flight results on disposal', async () => {
  let finish!: (value: DNSQuery) => void
  const query = vi.fn(() => new Promise<DNSQuery>((resolve) => (finish = resolve)))
  const resolver = createDNSResolver(query, true)
  const result = resolver.resolve(['a.example', 'b.example'])
  await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1))
  resolver.dispose()
  finish(answer())
  expect(await result).toEqual({ 'a.example': null, 'b.example': null })
  expect(query).toHaveBeenCalledTimes(1)
})

it('limits concurrent queries to six', async () => {
  let active = 0
  let maximum = 0
  const query = vi.fn(async () => {
    maximum = Math.max(maximum, ++active)
    await new Promise((resolve) => setTimeout(resolve, 1))
    active--
    return answer()
  })
  const resolver = createDNSResolver(query)
  const result = resolver.resolve(Array.from({ length: 20 }, (_, index) => `${index}.example`))
  await vi.runAllTimersAsync()
  await result
  expect(maximum).toBe(6)
})

it('preserves TTL and accepted addresses for other kernels', async () => {
  const query = vi.fn().mockResolvedValue(answer(1, '192.168.1.1', false))
  const resolver = createDNSResolver(query)
  expect(await resolver.resolve(['example.com'])).toEqual({ 'example.com': '192.168.1.1' })
  await vi.advanceTimersByTimeAsync(1000)
  await resolver.resolve(['example.com'])
  expect(query).toHaveBeenCalledTimes(2)
})

it('preserves the fixed negative cache for other kernels', async () => {
  const query = vi.fn().mockRejectedValue(new Error('offline'))
  const resolver = createDNSResolver(query)
  await resolver.resolve(['example.com'])
  for (let attempt = 0; attempt < 3; attempt++) {
    await vi.advanceTimersByTimeAsync(30_000)
    await resolver.resolve(['example.com'])
    expect(query).toHaveBeenCalledTimes((attempt + 2) * 2)
  }
})
