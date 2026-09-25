import {
  challengeBadge,
  pendingChallengeCount,
  resolveActiveTab,
  visibleTabs,
  type TabsInput,
} from '@/assembly/singbox/tools/tabs'
import { describe, expect, it } from 'vitest'

const none: TabsInput = {
  tailscale: false,
  openvpn: false,
  openconnect: false,
  ebpf: false,
  tailscaleSeen: false,
  openvpnSeen: false,
  openconnectSeen: false,
  ebpfInbounds: 0,
}

describe('visibleTabs', () => {
  it('always shows network', () => {
    expect(visibleTabs(none)).toEqual(['network'])
  })

  it('needs both the capability and an endpoint', () => {
    expect(visibleTabs({ ...none, tailscale: true })).toEqual(['network'])
    expect(visibleTabs({ ...none, tailscaleSeen: true })).toEqual(['network'])
    expect(visibleTabs({ ...none, tailscale: true, tailscaleSeen: true })).toEqual([
      'network',
      'tailscale',
    ])
  })

  it('orders all tabs', () => {
    expect(
      visibleTabs({
        tailscale: true,
        openvpn: true,
        openconnect: true,
        ebpf: true,
        tailscaleSeen: true,
        openvpnSeen: true,
        openconnectSeen: true,
        ebpfInbounds: 1,
      }),
    ).toEqual(['network', 'tailscale', 'openvpn', 'openconnect', 'ebpf'])
  })

  it('hides eBPF without inbounds', () => {
    expect(visibleTabs({ ...none, ebpf: true })).toEqual(['network'])
  })
})

describe('resolveActiveTab', () => {
  it('keeps a visible tab and falls back to network', () => {
    expect(resolveActiveTab('tailscale', ['network', 'tailscale'])).toBe('tailscale')
    expect(resolveActiveTab('tailscale', ['network'])).toBe('network')
    expect(resolveActiveTab('garbage', ['network'])).toBe('network')
  })
})

describe('pendingChallengeCount', () => {
  it('counts endpoints with a challenge', () => {
    expect(pendingChallengeCount([])).toBe(0)
    expect(pendingChallengeCount([{}, { challenge: { id: '1' } }, { challenge: undefined }])).toBe(
      1,
    )
    expect(pendingChallengeCount([{ challenge: {} }, { challenge: {} }])).toBe(2)
  })

  it('hides the badge when nothing is pending', () => {
    expect(challengeBadge([{}])).toBeUndefined()
    expect(challengeBadge([{ challenge: {} }])).toBe(1)
  })
})
