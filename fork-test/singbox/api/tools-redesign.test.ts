import { proxyMap } from '@/assembly/proxies'
import { outboundOptions } from '@/assembly/singbox/tools/common'
import { appendThroughput, THROUGHPUT_HISTORY } from '@/assembly/singbox/tools/network-quality'
import { natTone } from '@/assembly/singbox/tools/stun'
import { EXPIRY_SOON_SECONDS, expiryState, pingPath } from '@/assembly/singbox/tools/tailscale'
import { deadlineIn } from '@/assembly/singbox/tools/vpn'
import type { Proxy } from '@/types'
import { describe, expect, it } from 'vitest'

const now = 1_800_000_000

describe('expiryState', () => {
  it('classifies expiry', () => {
    expect(expiryState({ keyExpiry: 0, expired: false }, now)).toBe('ok')
    expect(expiryState({ keyExpiry: 0, expired: true }, now)).toBe('expired')
    expect(expiryState({ keyExpiry: now - 1, expired: false }, now)).toBe('expired')
    expect(expiryState({ keyExpiry: now, expired: false }, now)).toBe('expired')
    expect(expiryState({ keyExpiry: now + EXPIRY_SOON_SECONDS, expired: false }, now)).toBe('soon')
    expect(expiryState({ keyExpiry: now + EXPIRY_SOON_SECONDS + 1, expired: false }, now)).toBe(
      'ok',
    )
  })
})

describe('pingPath', () => {
  const base = { isDirect: false, peerRelay: '', derpRegionID: 0, derpRegionCode: '' }

  it('prefers direct, then peer relay, then DERP', () => {
    expect(pingPath({ ...base, isDirect: true, peerRelay: 'x', derpRegionID: 3 })).toBe('direct')
    expect(pingPath({ ...base, peerRelay: '1.2.3.4:5', derpRegionID: 3 })).toBe('relay')
    expect(pingPath({ ...base, derpRegionID: 3 })).toBe('derp')
    expect(pingPath({ ...base, derpRegionCode: 'sfo' })).toBe('derp')
    expect(pingPath(base)).toBe('unknown')
  })
})

describe('appendThroughput', () => {
  it('appends increasing points and ignores stale ones', () => {
    let history = appendThroughput([], { elapsedMs: 100, downloadMbps: 1, uploadMbps: 0 })
    history = appendThroughput(history, { elapsedMs: 100, downloadMbps: 2, uploadMbps: 0 })
    history = appendThroughput(history, { elapsedMs: 50, downloadMbps: 3, uploadMbps: 0 })
    history = appendThroughput(history, { elapsedMs: 200, downloadMbps: 4, uploadMbps: 1 })

    expect(history).toEqual([
      { elapsedMs: 100, downloadMbps: 1, uploadMbps: 0 },
      { elapsedMs: 200, downloadMbps: 4, uploadMbps: 1 },
    ])
  })

  it('keeps at most THROUGHPUT_HISTORY points', () => {
    let history: ReturnType<typeof appendThroughput> = []
    for (let index = 1; index <= THROUGHPUT_HISTORY + 5; index++) {
      history = appendThroughput(history, { elapsedMs: index, downloadMbps: index, uploadMbps: 0 })
    }

    expect(history).toHaveLength(THROUGHPUT_HISTORY)
    expect(history[0].elapsedMs).toBe(6)
  })
})

describe('natTone', () => {
  it('maps NAT behaviours to tones', () => {
    expect(natTone('endpointIndependent')).toBe('good')
    expect(natTone('addressDependent')).toBe('fair')
    expect(natTone('addressAndPortDependent')).toBe('poor')
    expect(natTone('unknown')).toBe('unknown')
  })
})

describe('deadlineIn', () => {
  it('returns remaining seconds', () => {
    expect(deadlineIn({ deadline: 0 }, now)).toBeUndefined()
    expect(deadlineIn({ deadline: now + 30 }, now)).toBe(30)
    expect(deadlineIn({ deadline: now - 5 }, now)).toBe(0)
  })

  it('floors to whole seconds for a fractional now', () => {
    expect(deadlineIn({ deadline: now + 30 }, now + 0.4)).toBe(29)
    expect(deadlineIn({ deadline: now + 30 }, now + 29.6)).toBe(0)
    expect(deadlineIn({ deadline: now + 30 }, now - 0.5)).toBe(30)
  })
})

describe('outboundOptions', () => {
  it('lists outbounds with type and latest delay', () => {
    const proxy = (name: string, type: string, delays: number[]) =>
      ({
        name,
        type,
        history: delays.map((delay, index) => ({ time: String(index), delay })),
        extra: {},
        udp: false,
        xudp: false,
        now: '',
      }) as unknown as Proxy

    proxyMap.value = {
      GLOBAL: proxy('GLOBAL', 'Selector', []),
      b: proxy('b', 'VLESS', [120, 80]),
      a: proxy('a', 'Direct', [0]),
    }

    expect(outboundOptions.value).toEqual([
      { tag: 'a', type: 'Direct', delay: undefined },
      { tag: 'b', type: 'VLESS', delay: 80 },
    ])
  })
})
