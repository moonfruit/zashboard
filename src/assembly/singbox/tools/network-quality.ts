import { serverStream } from '../api/client'
import {
  StartedService,
  type NetworkQualityTestProgress,
} from '../api/gen/daemon/started_service_pb'
import { runStreaming } from './common'

export type NetworkQualityOptions = {
  configURL: string
  outboundTag: string
  serial: boolean
  http3: boolean
  maxRuntimeSeconds: number
}

export type Accuracy = 'low' | 'medium' | 'high'

export type NetworkQualityResult = {
  phase: 'idle' | 'download' | 'upload' | 'done'
  downloadMbps: number
  uploadMbps: number
  downloadRPM: number
  uploadRPM: number
  idleLatencyMs: number
  elapsedMs: number
  isFinal: boolean
  error: string
  accuracy: {
    downloadCapacity: Accuracy
    uploadCapacity: Accuracy
    downloadRPM: Accuracy
    uploadRPM: Accuracy
  }
}

export const NETWORK_QUALITY_DEFAULTS: NetworkQualityOptions = {
  configURL: 'https://mensura.cdn-apple.com/api/v1/gm/config',
  outboundTag: '',
  serial: false,
  http3: false,
  maxRuntimeSeconds: 0,
}

const PHASES = ['idle', 'download', 'upload', 'done'] as const
const ACCURACY = ['low', 'medium', 'high'] as const

const accuracyOf = (value: number): Accuracy => ACCURACY[value] ?? 'low'

export const toNetworkQualityResult = (
  progress: NetworkQualityTestProgress,
): NetworkQualityResult => ({
  phase: PHASES[progress.phase] ?? 'idle',
  downloadMbps: Number(progress.downloadCapacity) / 1_000_000,
  uploadMbps: Number(progress.uploadCapacity) / 1_000_000,
  downloadRPM: progress.downloadRPM,
  uploadRPM: progress.uploadRPM,
  idleLatencyMs: progress.idleLatencyMs,
  elapsedMs: Number(progress.elapsedMs),
  isFinal: progress.isFinal,
  error: progress.error,
  accuracy: {
    downloadCapacity: accuracyOf(progress.downloadCapacityAccuracy),
    uploadCapacity: accuracyOf(progress.uploadCapacityAccuracy),
    downloadRPM: accuracyOf(progress.downloadRPMAccuracy),
    uploadRPM: accuracyOf(progress.uploadRPMAccuracy),
  },
})

export type ThroughputPoint = {
  elapsedMs: number
  downloadMbps: number
  uploadMbps: number
}

export const THROUGHPUT_HISTORY = 120

export const appendThroughput = (
  history: ThroughputPoint[],
  result: Pick<NetworkQualityResult, 'elapsedMs' | 'downloadMbps' | 'uploadMbps'>,
): ThroughputPoint[] => {
  const last = history[history.length - 1]

  if (last && result.elapsedMs <= last.elapsedMs) return history

  return [
    ...history,
    {
      elapsedMs: result.elapsedMs,
      downloadMbps: result.downloadMbps,
      uploadMbps: result.uploadMbps,
    },
  ].slice(-THROUGHPUT_HISTORY)
}

export const startNetworkQualityTest = (
  options: NetworkQualityOptions,
  onProgress: (result: NetworkQualityResult) => void,
) =>
  runStreaming(
    (signal) => serverStream(StartedService.method.startNetworkQualityTest, options, signal),
    (progress) => onProgress(toNetworkQualityResult(progress)),
  )
