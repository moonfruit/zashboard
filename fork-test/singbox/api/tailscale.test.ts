import { TailscaleStatusUpdateSchema } from '@/assembly/singbox/api/gen/daemon/started_service_pb'
import { findTailscalePeer, toTailscaleEndpoints } from '@/assembly/singbox/tools/tailscale'
import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'

const peer = (hostName: string, extra: Record<string, unknown> = {}) => ({
  hostName,
  dnsName: `${hostName}.example.ts.net.`,
  os: 'linux',
  tailscaleIPs: [`100.64.0.${hostName.length}`],
  online: true,
  stableID: `id-${hostName}`,
  rxBytes: 10n,
  txBytes: 20n,
  keyExpiry: 1_700_000_000n,
  ...extra,
})

describe('toTailscaleEndpoints', () => {
  it('maps endpoints, users, peers and exit node options', () => {
    const [endpoint] = toTailscaleEndpoints(
      create(TailscaleStatusUpdateSchema, {
        endpoints: [
          {
            endpointTag: 'ts',
            keyAuth: false,
            backendState: 'Running',
            stateText: 'Connected',
            networkName: 'example.ts.net',
            magicDNSSuffix: 'example.ts.net',
            self: peer('me'),
            exitNode: peer('gateway', { exitNode: true, exitNodeOption: true }),
            userGroups: [
              {
                userID: 1n,
                loginName: 'alice@example.com',
                displayName: 'Alice',
                peers: [
                  peer('gateway', { exitNode: true, exitNodeOption: true }),
                  peer('laptop', { online: false }),
                ],
              },
            ],
          },
        ],
      }),
    )

    expect(endpoint.tag).toBe('ts')
    expect(endpoint.keyAuth).toBe(false)
    expect(endpoint.users[0].peers[0].shareeNode).toBe(false)
    expect(endpoint.self?.hostName).toBe('me')
    expect(endpoint.exitNode?.stableID).toBe('id-gateway')
    expect(endpoint.users).toEqual([
      expect.objectContaining({
        id: '1',
        name: 'Alice',
        peers: [
          expect.objectContaining({ hostName: 'gateway' }),
          expect.objectContaining({ hostName: 'laptop', online: false }),
        ],
      }),
    ])
    expect(endpoint.users[0].peers[0].rxBytes).toBe(10)
    expect(endpoint.users[0].peers[0].keyExpiry).toBe(1_700_000_000)
    expect(endpoint.exitNodeOptions.map((item) => item.hostName)).toEqual(['gateway'])
  })

  it('falls back to the login name', () => {
    const [endpoint] = toTailscaleEndpoints(
      create(TailscaleStatusUpdateSchema, {
        endpoints: [
          { endpointTag: 'ts', userGroups: [{ userID: 2n, loginName: 'bob@x', peers: [] }] },
        ],
      }),
    )

    expect(endpoint.users[0].name).toBe('bob@x')
    expect(endpoint.self).toBeUndefined()
  })
})

describe('findTailscalePeer', () => {
  const endpoints = toTailscaleEndpoints(
    create(TailscaleStatusUpdateSchema, {
      endpoints: [
        {
          endpointTag: 'ts',
          self: peer('me'),
          userGroups: [{ userID: 1n, loginName: 'a', peers: [peer('laptop'), peer('phone')] }],
        },
      ],
    }),
  )

  it('looks up the current peer by tag and stable id', () => {
    const found = findTailscalePeer(endpoints, { tag: 'ts', stableID: 'id-phone', isSelf: false })
    expect(found?.endpoint.tag).toBe('ts')
    expect(found?.peer.hostName).toBe('phone')
  })

  it('looks up the self node', () => {
    expect(
      findTailscalePeer(endpoints, { tag: 'ts', stableID: 'id-me', isSelf: true })?.peer.hostName,
    ).toBe('me')
    expect(
      findTailscalePeer(endpoints, { tag: 'ts', stableID: 'id-x', isSelf: true }),
    ).toBeUndefined()
  })

  it('returns undefined when the peer or endpoint disappears', () => {
    expect(
      findTailscalePeer(endpoints, { tag: 'ts', stableID: 'id-gone', isSelf: false }),
    ).toBeUndefined()
    expect(
      findTailscalePeer(endpoints, { tag: 'other', stableID: 'id-phone', isSelf: false }),
    ).toBeUndefined()
    expect(
      findTailscalePeer([], { tag: 'ts', stableID: 'id-phone', isSelf: false }),
    ).toBeUndefined()
  })
})
