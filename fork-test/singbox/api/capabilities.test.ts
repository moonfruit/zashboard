import type { Cap } from '@/assembly/backend'
import { singboxCaps } from '@/assembly/singbox/capabilities'
import { describe, expect, it } from 'vitest'

const API_CAPS: Cap[] = [
  'singboxApi',
  'tools',
  'backendEvents',
  'tailscale',
  'openvpn',
  'openconnect',
  'ebpfDiagnostics',
]

describe('singboxCaps with sing-box API', () => {
  it('keeps the Clash-only matrix without api', () => {
    const caps = singboxCaps('moonfruit', false)

    for (const cap of API_CAPS) expect(caps[cap]).toBe(false)
    expect(caps.coreRestart).toBe(true)
  })

  it('gates tool caps by api version', () => {
    const v3 = singboxCaps('moonfruit', false, { apiVersion: 3 })
    const v2 = singboxCaps('moonfruit', false, { apiVersion: 2 })
    const v5 = singboxCaps('moonfruit', false, { apiVersion: 5 })

    expect(v2.singboxApi).toBe(true)
    expect(v2.tools).toBe(true)
    expect(v2.backendEvents).toBe(true)
    expect(v2.tailscale).toBe(false)
    expect(v3.tailscale).toBe(true)
    expect(v3.openvpn).toBe(true)
    expect(v3.openconnect).toBe(true)
    expect(v3.ebpfDiagnostics).toBe(false)
    expect(v5.ebpfDiagnostics).toBe(true)
  })

  it('does not change the other caps', () => {
    const without = singboxCaps('moonfruit', false)
    const withApi = singboxCaps('moonfruit', false, { apiVersion: 5 })

    for (const [cap, value] of Object.entries(without)) {
      if (!API_CAPS.includes(cap as Cap)) expect(withApi[cap as Cap]).toBe(value)
    }
  })
})
