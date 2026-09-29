import { getLatencyFromFetchAPI } from '@/assembly/overview-fork/latency'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getLatencyFromFetchAPI', () => {
  it('returns the elapsed time for a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')))
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(142)

    await expect(getLatencyFromFetchAPI('https://chatgpt.com/cdn-cgi/trace')).resolves.toBe(42)
  })

  it('adds a cache-busting query and disables the cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)

    await getLatencyFromFetchAPI('https://api.anthropic.com/cdn-cgi/trace')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/^https:\/\/api\.anthropic\.com\/cdn-cgi\/trace\?_=\d+$/)
    expect(init).toMatchObject({ cache: 'no-store' })
  })

  it('returns 0 on HTTP errors and network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })))
    await expect(getLatencyFromFetchAPI('https://example.com')).resolves.toBe(0)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(getLatencyFromFetchAPI('https://example.com')).resolves.toBe(0)
  })
})
