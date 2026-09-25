import { api, serverStream } from '../api/client'
import {
  StartedService,
  type OpenConnectAuthChallenge,
  type OpenConnectStatusUpdate,
  type OpenConnectTunnelInfo,
  type OpenVPNChallenge,
  type OpenVPNStatusUpdate,
  type OpenVPNTunnelInfo,
} from '../api/gen/daemon/started_service_pb'
import { createSharedStream } from '../api/stream'
import { safeHttpUrl } from './common'

export type VpnTunnelView = {
  server: string
  addresses: string[]
  dns: string[]
  mtu: number
  connectedSince: number
  extra: { label: 'vpnCipher' | 'vpnTransport' | 'vpnNetwork'; value: string }[]
}

export type OpenVPNChallengeView = {
  id: string
  kind: 'credentials' | 'secret' | 'message' | 'open-url' | 'unknown'
  username: string
  message: string
  secretMessage: string
  url: string
  echo: boolean
  previousError: string
  deadline: number
}

export type OpenVPNEndpointView = {
  tag: string
  state: string
  stateText: string
  error: string
  tunnel?: VpnTunnelView
  challenge?: OpenVPNChallengeView
}

export type OpenConnectField = {
  key: string
  label: string
  kind: 'text' | 'password' | 'select' | 'hidden'
  value: string
  options: { value: string; label: string }[]
}

export type OpenConnectChallengeView = {
  id: string
  banner: string
  message: string
  error: string
} & (
  { type: 'form'; fields: OpenConnectField[] } | { type: 'browser'; url: string } | { type: 'none' }
)

export type OpenConnectEndpointView = {
  tag: string
  state: string
  stateText: string
  error: string
  tunnel?: VpnTunnelView
  challenge?: OpenConnectChallengeView
}

const OPENVPN_KINDS = new Set(['credentials', 'secret', 'message', 'open-url'])
const FIELD_KINDS = new Set(['text', 'password', 'select', 'hidden'])

export const openVPNStream = createSharedStream((signal) =>
  serverStream(StartedService.method.subscribeOpenVPNStatus, {}, signal),
)

export const openConnectStream = createSharedStream((signal) =>
  serverStream(StartedService.method.subscribeOpenConnectStatus, {}, signal),
)

const toTunnel = (
  info: OpenVPNTunnelInfo | OpenConnectTunnelInfo,
  extra: VpnTunnelView['extra'],
): VpnTunnelView => ({
  server: info.server,
  addresses: [...info.ipv4, ...info.ipv6],
  dns: [...info.dns],
  mtu: info.mtu,
  connectedSince: Number(info.connectedSince),
  extra: extra.filter((item) => item.value),
})

const toOpenVPNChallenge = (challenge: OpenVPNChallenge): OpenVPNChallengeView => ({
  id: challenge.id,
  kind: OPENVPN_KINDS.has(challenge.kind)
    ? (challenge.kind as OpenVPNChallengeView['kind'])
    : 'unknown',
  username: challenge.username,
  message: challenge.message,
  secretMessage: challenge.secretMessage,
  url: safeHttpUrl(challenge.url),
  echo: challenge.echo,
  previousError: challenge.previousError,
  deadline: Number(challenge.deadline),
})

export const toOpenVPNEndpoints = (update: OpenVPNStatusUpdate): OpenVPNEndpointView[] =>
  update.endpoints.map((endpoint) => ({
    tag: endpoint.endpointTag,
    state: endpoint.state,
    stateText: endpoint.stateText,
    error: endpoint.error,
    tunnel: endpoint.tunnelInfo
      ? toTunnel(endpoint.tunnelInfo, [
          { label: 'vpnNetwork', value: endpoint.tunnelInfo.network },
          { label: 'vpnCipher', value: endpoint.tunnelInfo.cipher },
        ])
      : undefined,
    challenge: endpoint.challenge ? toOpenVPNChallenge(endpoint.challenge) : undefined,
  }))

const toOpenConnectChallenge = (challenge: OpenConnectAuthChallenge): OpenConnectChallengeView => {
  const base = {
    id: challenge.id,
    banner: challenge.banner,
    message: challenge.message,
    error: challenge.error,
  }

  if (challenge.challenge.case === 'form') {
    return {
      ...base,
      type: 'form',
      fields: challenge.challenge.value.fields.map((field) => ({
        key: field.submissionKey || field.name,
        label: field.label || field.name,
        kind: FIELD_KINDS.has(field.kind) ? (field.kind as OpenConnectField['kind']) : 'text',
        value: field.value,
        options: field.options.map((option) => ({ value: option.value, label: option.label })),
      })),
    }
  }

  if (challenge.challenge.case === 'browser') {
    return { ...base, type: 'browser', url: safeHttpUrl(challenge.challenge.value.url) }
  }

  return { ...base, type: 'none' }
}

export const toOpenConnectEndpoints = (
  update: OpenConnectStatusUpdate,
): OpenConnectEndpointView[] =>
  update.endpoints.map((endpoint) => ({
    tag: endpoint.endpointTag,
    state: endpoint.state,
    stateText: endpoint.stateText,
    error: endpoint.error,
    tunnel: endpoint.tunnelInfo
      ? toTunnel(endpoint.tunnelInfo, [
          { label: 'vpnTransport', value: endpoint.tunnelInfo.transport },
        ])
      : undefined,
    challenge: endpoint.authChallenge ? toOpenConnectChallenge(endpoint.authChallenge) : undefined,
  }))

export const initialFormValues = (fields: OpenConnectField[]) =>
  Object.fromEntries(
    fields.map((field) => [
      field.key,
      field.value || (field.kind === 'select' ? (field.options[0]?.value ?? '') : ''),
    ]),
  )

export const submitOpenVPNChallenge = async (
  endpointTag: string,
  challengeID: string,
  response: { username?: string; password?: string; secret?: string },
) => {
  await api().submitOpenVPNChallengeResponse({ endpointTag, challengeID, ...response })
}

export const cancelOpenVPNChallenge = async (endpointTag: string, challengeID: string) => {
  await api().cancelOpenVPNChallenge({ endpointTag, challengeID })
}

export const submitOpenConnectForm = async (
  endpointTag: string,
  challengeID: string,
  values: Record<string, string>,
) => {
  await api().submitOpenConnectAuthResponse({
    endpointTag,
    challengeID,
    response: { case: 'form', value: { values } },
  })
}

export const cancelOpenConnectChallenge = async (endpointTag: string, challengeID: string) => {
  await api().cancelOpenConnectAuthChallenge({ endpointTag, challengeID })
}

export const deadlineIn = (
  challenge: Pick<OpenVPNChallengeView, 'deadline'>,
  nowSeconds: number,
): number | undefined =>
  challenge.deadline > 0 ? Math.max(0, Math.floor(challenge.deadline - nowSeconds)) : undefined
