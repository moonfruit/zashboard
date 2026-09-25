import { toJson, type JsonValue } from '@bufbuild/protobuf'
import { api } from '../api/client'
import {
  EBPFInboundDiagnosticsSchema,
  EBPFKernelRuntimeDiagnosticsSchema,
  type EBPFDiagnosticsResponse,
} from '../api/gen/daemon/started_service_pb'

export type EbpfInboundSummary = {
  tag: string
  state: string
  dataPlane: string
  udpSessions: number
  lastError: string
  detail: JsonValue
}

export type EbpfDiagnostics = {
  inbounds: EbpfInboundSummary[]
  kernelRuntime: JsonValue | undefined
}

export const toEbpfDiagnostics = (response: EBPFDiagnosticsResponse): EbpfDiagnostics => ({
  inbounds: response.inbounds.map((inbound) => ({
    tag: inbound.tag,
    state: inbound.state,
    dataPlane: [
      inbound.localEnabled && inbound.localDataPlane,
      inbound.sharedEnabled && inbound.sharedDataPlane,
    ]
      .filter(Boolean)
      .join(' / '),
    udpSessions: Number(inbound.udpSessionCount),
    lastError: inbound.lastError,
    detail: toJson(EBPFInboundDiagnosticsSchema, inbound),
  })),
  kernelRuntime: response.kernelRuntime
    ? toJson(EBPFKernelRuntimeDiagnosticsSchema, response.kernelRuntime)
    : undefined,
})

export const fetchEbpfDiagnostics = async () =>
  toEbpfDiagnostics(await api().getEBPFDiagnostics({}))
