import { fallBackToClash } from '@/assembly/singbox/api/probe'
import { statusStream } from '@/assembly/singbox/api/streams'
import { Code, ConnectError } from '@connectrpc/connect'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/assembly/singbox/api/probe', () => ({ fallBackToClash: vi.fn() }))
vi.mock('@/assembly/singbox/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/assembly/singbox/api/client')>()

  return {
    ...actual,
    serverStream: vi.fn(async function* () {
      yield* []
      throw new ConnectError('bad secret', Code.Unauthenticated)
    }),
  }
})

describe('resident stream terminal errors', () => {
  it('fall back to the Clash path with the mapped reason', async () => {
    const off = statusStream.subscribe(() => {})

    await vi.waitFor(() => expect(fallBackToClash).toHaveBeenCalledWith('unauthorized'))
    expect(statusStream.phase.value).toBe('error')
    off()
  })
})
