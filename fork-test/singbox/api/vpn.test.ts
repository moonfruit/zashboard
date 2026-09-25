import {
  OpenConnectStatusUpdateSchema,
  OpenVPNStatusUpdateSchema,
} from '@/assembly/singbox/api/gen/daemon/started_service_pb'
import {
  initialFormValues,
  toOpenConnectEndpoints,
  toOpenVPNEndpoints,
} from '@/assembly/singbox/tools/vpn'
import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'

describe('OpenVPN', () => {
  it('maps tunnel and credential challenge', () => {
    const [endpoint] = toOpenVPNEndpoints(
      create(OpenVPNStatusUpdateSchema, {
        endpoints: [
          {
            endpointTag: 'ovpn',
            state: 'connected',
            tunnelInfo: {
              server: 'vpn.example.com:1194',
              network: 'udp',
              ipv4: ['10.8.0.2/24'],
              ipv6: ['fd00::2/64'],
              dns: ['10.8.0.1'],
              mtu: 1500,
              connectedSince: 1_700_000_000n,
              cipher: 'AES-256-GCM',
            },
            challenge: { id: 'c1', kind: 'credentials', username: 'alice', deadline: 5n },
          },
        ],
      }),
    )

    expect(endpoint.tunnel?.addresses).toEqual(['10.8.0.2/24', 'fd00::2/64'])
    expect(endpoint.tunnel?.connectedSince).toBe(1_700_000_000)
    expect(endpoint.tunnel?.extra).toEqual([
      { label: 'vpnNetwork', value: 'udp' },
      { label: 'vpnCipher', value: 'AES-256-GCM' },
    ])
    expect(endpoint.challenge).toMatchObject({
      id: 'c1',
      kind: 'credentials',
      username: 'alice',
      deadline: 5,
    })
  })

  it('marks unknown challenge kinds', () => {
    const [endpoint] = toOpenVPNEndpoints(
      create(OpenVPNStatusUpdateSchema, {
        endpoints: [{ endpointTag: 'o', challenge: { id: 'x', kind: 'weird' } }],
      }),
    )

    expect(endpoint.challenge?.kind).toBe('unknown')
    expect(endpoint.tunnel).toBeUndefined()
  })
})

describe('OpenConnect', () => {
  it('maps form and browser challenges', () => {
    const [form, browser] = toOpenConnectEndpoints(
      create(OpenConnectStatusUpdateSchema, {
        endpoints: [
          {
            endpointTag: 'oc1',
            authChallenge: {
              id: 'f',
              message: 'Login',
              challenge: {
                case: 'form',
                value: {
                  fields: [
                    {
                      submissionKey: 'user',
                      name: 'username',
                      label: 'User',
                      kind: 'text',
                      value: 'bob',
                    },
                    {
                      name: 'group',
                      label: 'Group',
                      kind: 'select',
                      options: [{ value: 'a', label: 'A' }],
                    },
                    { name: 'csrf', kind: 'hidden', value: 't0k' },
                    { name: 'otp', label: 'OTP', kind: 'weird' },
                  ],
                },
              },
            },
          },
          {
            endpointTag: 'oc2',
            authChallenge: {
              id: 'b',
              challenge: { case: 'browser', value: { url: 'https://sso.example.com' } },
            },
          },
        ],
      }),
    )

    const challenge = form.challenge
    expect(challenge?.type).toBe('form')
    if (challenge?.type !== 'form') return
    expect(challenge.fields.map((field) => [field.key, field.kind])).toEqual([
      ['user', 'text'],
      ['group', 'select'],
      ['csrf', 'hidden'],
      ['otp', 'text'],
    ])
    expect(initialFormValues(challenge.fields)).toEqual({
      user: 'bob',
      group: 'a',
      csrf: 't0k',
      otp: '',
    })
    expect(browser.challenge).toMatchObject({ type: 'browser', url: 'https://sso.example.com' })
  })
})
