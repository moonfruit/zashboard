import { api, serverStream } from '../api/client'
import {
  StartedService,
  type TailscalePeer,
  type TailscaleStatusUpdate,
} from '../api/gen/daemon/started_service_pb'
import { createSharedStream } from '../api/stream'
import { runStreaming, safeHttpUrl } from './common'

export const PING_HISTORY = 30

export type TailscalePeerView = {
  stableID: string
  hostName: string
  dnsName: string
  os: string
  ips: string[]
  online: boolean
  active: boolean
  exitNode: boolean
  exitNodeOption: boolean
  rxBytes: number
  txBytes: number
  keyExpiry: number
  expired: boolean
  lastSeen: number
  shareeNode: boolean
}

export type TailscaleUserView = {
  id: string
  name: string
  peers: TailscalePeerView[]
}

export type TailscaleEndpointView = {
  tag: string
  backendState: string
  stateText: string
  authURL: string
  networkName: string
  magicDNSSuffix: string
  keyAuth: boolean
  self?: TailscalePeerView
  exitNode?: TailscalePeerView
  users: TailscaleUserView[]
  exitNodeOptions: TailscalePeerView[]
}

export type TailscalePingSample = {
  latencyMs: number
  isDirect: boolean
  endpoint: string
  derpRegionCode: string
  peerRelay: string
  derpRegionID: number
  error: string
}

export const tailscaleStream = createSharedStream((signal) =>
  serverStream(StartedService.method.subscribeTailscaleStatus, {}, signal),
)

const toPeer = (peer: TailscalePeer): TailscalePeerView => ({
  stableID: peer.stableID,
  hostName: peer.hostName,
  dnsName: peer.dnsName,
  os: peer.os,
  ips: [...peer.tailscaleIPs],
  online: peer.online,
  active: peer.active,
  exitNode: peer.exitNode,
  exitNodeOption: peer.exitNodeOption,
  rxBytes: Number(peer.rxBytes),
  txBytes: Number(peer.txBytes),
  keyExpiry: Number(peer.keyExpiry),
  expired: peer.expired,
  lastSeen: Number(peer.lastSeen),
  shareeNode: peer.shareeNode,
})

export const toTailscaleEndpoints = (update: TailscaleStatusUpdate): TailscaleEndpointView[] =>
  update.endpoints.map((endpoint) => {
    const users = endpoint.userGroups.map((group) => ({
      id: String(group.userID),
      name: group.displayName || group.loginName,
      peers: group.peers.map(toPeer),
    }))

    return {
      tag: endpoint.endpointTag,
      backendState: endpoint.backendState,
      stateText: endpoint.stateText,
      authURL: safeHttpUrl(endpoint.authURL),
      networkName: endpoint.networkName,
      magicDNSSuffix: endpoint.magicDNSSuffix,
      keyAuth: endpoint.keyAuth,
      self: endpoint.self ? toPeer(endpoint.self) : undefined,
      exitNode: endpoint.exitNode ? toPeer(endpoint.exitNode) : undefined,
      users,
      exitNodeOptions: users.flatMap((user) => user.peers).filter((peer) => peer.exitNodeOption),
    }
  })

export const setTailscaleExitNode = async (endpointTag: string, stableID: string) => {
  await api().setTailscaleExitNode({ endpointTag, stableID })
}

export const logoutTailscale = async (endpointTag: string) => {
  await api().tailscaleLogout({ endpointTag })
}

export const startTailscalePing = (
  endpointTag: string,
  peerIP: string,
  onSample: (sample: TailscalePingSample) => void,
) =>
  runStreaming(
    (signal) =>
      serverStream(StartedService.method.startTailscalePing, { endpointTag, peerIP }, signal),
    (response) =>
      onSample({
        latencyMs: response.latencyMs,
        isDirect: response.isDirect,
        endpoint: response.endpoint,
        derpRegionCode: response.derpRegionCode,
        peerRelay: response.peerRelay,
        derpRegionID: response.derpRegionID,
        error: response.error,
      }),
  )

export const EXPIRY_SOON_SECONDS = 30 * 24 * 3600

export type ExpiryState = 'expired' | 'soon' | 'ok'

export type PingPath = 'direct' | 'relay' | 'derp' | 'unknown'

export const expiryState = (
  peer: Pick<TailscalePeerView, 'keyExpiry' | 'expired'>,
  nowSeconds: number,
): ExpiryState => {
  if (peer.expired || (peer.keyExpiry > 0 && peer.keyExpiry <= nowSeconds)) return 'expired'
  if (peer.keyExpiry > 0 && peer.keyExpiry - nowSeconds <= EXPIRY_SOON_SECONDS) return 'soon'
  return 'ok'
}

export const pingPath = (
  sample: Pick<TailscalePingSample, 'isDirect' | 'peerRelay' | 'derpRegionID' | 'derpRegionCode'>,
): PingPath => {
  if (sample.isDirect) return 'direct'
  if (sample.peerRelay) return 'relay'
  if (sample.derpRegionID > 0 || sample.derpRegionCode) return 'derp'
  return 'unknown'
}

export type TailscalePeerRef = {
  tag: string
  stableID: string
  isSelf: boolean
}

export const findTailscalePeer = (
  endpoints: TailscaleEndpointView[],
  ref: TailscalePeerRef,
): { endpoint: TailscaleEndpointView; peer: TailscalePeerView } | undefined => {
  const endpoint = endpoints.find((item) => item.tag === ref.tag)
  if (!endpoint) return undefined
  const peer = ref.isSelf
    ? endpoint.self
    : endpoint.users.flatMap((user) => user.peers).find((item) => item.stableID === ref.stableID)
  if (!peer || peer.stableID !== ref.stableID) return undefined
  return { endpoint, peer }
}
