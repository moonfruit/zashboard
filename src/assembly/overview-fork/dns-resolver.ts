import type { DNSQuery } from '@/types'
import * as ipaddr from 'ipaddr.js'
import pLimit from 'p-limit'

type Query = (name: string, type: string, signal: AbortSignal) => Promise<DNSQuery>
type Entry = { ip: string | null; expiresAt: number; failures: number }

export const createDNSResolver = (query: Query, requireSkipFakeIP = false) => {
  const cache = new Map<string, Entry>()
  const pending = new Map<string, Promise<string | null>>()
  const limit = pLimit(6)
  const controller = new AbortController()
  let unsupported = false
  let supported = !requireSkipFakeIP

  const stopped = () => controller.signal.aborted || unsupported

  const resolveHostname = (hostname: string): Promise<string | null> => {
    if (stopped()) return Promise.resolve(null)
    const cached = cache.get(hostname)
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.ip)
    const existing = pending.get(hostname)
    if (existing) return existing

    const request = limit(async () => {
      for (const [type, answerType] of [
        ['A', 1],
        ['AAAA', 28],
      ] as const) {
        if (stopped()) return null
        try {
          const result = await query(hostname, type, controller.signal)
          if (stopped()) return null
          if (requireSkipFakeIP && result.SkipFakeIP !== true) {
            unsupported = true
            return null
          }
          supported = true
          for (const answer of result.Answer ?? []) {
            if (answer.type !== answerType || !ipaddr.isValid(answer.data)) continue
            const address = ipaddr.process(answer.data)
            if (requireSkipFakeIP && address.range() !== 'unicast') continue
            const ip = address.toNormalizedString()
            const ttl = Number.isFinite(answer.TTL) ? answer.TTL * 1000 : 0
            cache.delete(hostname)
            cache.set(hostname, {
              ip,
              expiresAt: Date.now() + Math.max(requireSkipFakeIP ? 300_000 : 1000, ttl),
              failures: 0,
            })
            return ip
          }
        } catch {}
      }
      if (stopped()) return null
      const failures = Math.min(5, (cached?.failures ?? 0) + 1)
      cache.delete(hostname)
      cache.set(hostname, {
        ip: null,
        expiresAt:
          Date.now() +
          (requireSkipFakeIP ? Math.min(300_000, 30_000 * 2 ** (failures - 1)) : 30_000),
        failures,
      })
      return null
    }).finally(() => {
      pending.delete(hostname)
      while (cache.size > 4096) cache.delete(cache.keys().next().value!)
    })
    pending.set(hostname, request)
    return request
  }

  return {
    async resolve(hostnames: string[]) {
      const unique = [...new Set(hostnames)]
      if (!supported && unique.length) await resolveHostname(unique[0]!)
      const entries = await Promise.all(
        unique.map(async (hostname) => [hostname, await resolveHostname(hostname)] as const),
      )
      return Object.fromEntries(entries)
    },
    dispose() {
      controller.abort()
      cache.clear()
    },
  }
}
