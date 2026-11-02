import { queryDNSAPI } from '@/api/clash'
import axios from 'axios'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@/api/http', () => ({}))

afterEach(() => vi.restoreAllMocks())

it('sends the hyphenated REST parameter and cancellation signal', async () => {
  const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: {} })
  const signal = new AbortController().signal
  await queryDNSAPI({ name: 'example.com', type: 'A', skipFakeIP: true }, signal)
  expect(get).toHaveBeenCalledWith('/dns/query', {
    params: { name: 'example.com', type: 'A', 'skip-fake-ip': true },
    signal,
  })
})

it('preserves the ordinary DNS query request shape', async () => {
  const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: {} })
  await queryDNSAPI({ name: 'example.com', type: 'PTR' })
  expect(get).toHaveBeenCalledWith('/dns/query', {
    params: { name: 'example.com', type: 'PTR' },
  })
})
