import { serverStream } from '../api/client'
import { StartedService, type STUNTestProgress } from '../api/gen/daemon/started_service_pb'
import { runStreaming } from './common'

export const STUN_DEFAULT_SERVER = 'stun.voipgate.com:3478'

export type NatBehavior =
  'unknown' | 'endpointIndependent' | 'addressDependent' | 'addressAndPortDependent'

export type StunResult = {
  phase: 'binding' | 'mapping' | 'filtering' | 'done'
  externalAddr: string
  latencyMs: number
  natMapping: NatBehavior
  natFiltering: NatBehavior
  natTypeSupported: boolean
  isFinal: boolean
  error: string
}

const PHASES = ['binding', 'mapping', 'filtering', 'done'] as const
const MAPPING: NatBehavior[] = [
  'unknown',
  'unknown',
  'endpointIndependent',
  'addressDependent',
  'addressAndPortDependent',
]
const FILTERING: NatBehavior[] = [
  'unknown',
  'endpointIndependent',
  'addressDependent',
  'addressAndPortDependent',
]

export const toStunResult = (progress: STUNTestProgress): StunResult => ({
  phase: PHASES[progress.phase] ?? 'binding',
  externalAddr: progress.externalAddr,
  latencyMs: progress.latencyMs,
  natMapping: MAPPING[progress.natMapping] ?? 'unknown',
  natFiltering: FILTERING[progress.natFiltering] ?? 'unknown',
  natTypeSupported: progress.natTypeSupported,
  isFinal: progress.isFinal,
  error: progress.error,
})

export type NatTone = 'good' | 'fair' | 'poor' | 'unknown'

const NAT_TONES: Record<NatBehavior, NatTone> = {
  unknown: 'unknown',
  endpointIndependent: 'good',
  addressDependent: 'fair',
  addressAndPortDependent: 'poor',
}

export const natTone = (behavior: NatBehavior): NatTone => NAT_TONES[behavior]

export const startStunTest = (
  options: { server: string; outboundTag: string },
  onProgress: (result: StunResult) => void,
) =>
  runStreaming(
    (signal) => serverStream(StartedService.method.startSTUNTest, options, signal),
    (progress) => onProgress(toStunResult(progress)),
  )
