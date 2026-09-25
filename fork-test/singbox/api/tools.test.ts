import {
  EBPFDiagnosticsResponseSchema,
  NetworkQualityTestProgressSchema,
  STUNTestProgressSchema,
} from '@/assembly/singbox/api/gen/daemon/started_service_pb'
import { runStreaming } from '@/assembly/singbox/tools/common'
import { toEbpfDiagnostics } from '@/assembly/singbox/tools/ebpf'
import { toNetworkQualityResult } from '@/assembly/singbox/tools/network-quality'
import { toStunResult } from '@/assembly/singbox/tools/stun'
import { create } from '@bufbuild/protobuf'
import { describe, expect, it, vi } from 'vitest'

describe('network quality', () => {
  it('maps progress', () => {
    const result = toNetworkQualityResult(
      create(NetworkQualityTestProgressSchema, {
        phase: 2,
        downloadCapacity: 250_000_000n,
        uploadCapacity: 20_000_000n,
        downloadRPM: 900,
        uploadRPM: 400,
        idleLatencyMs: 12,
        elapsedMs: 8000n,
        downloadCapacityAccuracy: 2,
        uploadCapacityAccuracy: 1,
      }),
    )

    expect(result.phase).toBe('upload')
    expect(result.downloadMbps).toBe(250)
    expect(result.uploadMbps).toBe(20)
    expect(result.elapsedMs).toBe(8000)
    expect(result.accuracy.downloadCapacity).toBe('high')
    expect(result.accuracy.uploadCapacity).toBe('medium')
    expect(result.accuracy.downloadRPM).toBe('low')
  })
})

describe('stun', () => {
  it('maps NAT behaviours, skipping the reserved mapping value', () => {
    const result = toStunResult(
      create(STUNTestProgressSchema, {
        phase: 3,
        externalAddr: '1.2.3.4:5000',
        latencyMs: 30,
        natMapping: 2,
        natFiltering: 3,
        isFinal: true,
        natTypeSupported: true,
      }),
    )

    expect(result.phase).toBe('done')
    expect(result.natMapping).toBe('endpointIndependent')
    expect(result.natFiltering).toBe('addressAndPortDependent')
    expect(toStunResult(create(STUNTestProgressSchema, { natMapping: 1 })).natMapping).toBe(
      'unknown',
    )
  })
})

describe('runStreaming', () => {
  it('delivers values and stops on cancel', async () => {
    const values: number[] = []
    const run = runStreaming(
      async function* (signal) {
        yield 1
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
      },
      (value) => values.push(value),
    )

    await vi.waitFor(() => expect(values).toEqual([1]))
    run.cancel()
    await run.done
    expect(values).toEqual([1])
  })
})

describe('ebpf', () => {
  it('summarises inbounds and keeps json details', () => {
    const diagnostics = toEbpfDiagnostics(
      create(EBPFDiagnosticsResponseSchema, {
        inbounds: [
          {
            tag: 'ebpf-in',
            state: 'running',
            localEnabled: true,
            localDataPlane: 'tc',
            sharedEnabled: false,
            udpSessionCount: 7n,
            lastError: '',
          },
        ],
        kernelRuntime: { observedAt: 1n, programsError: 'denied' },
      }),
    )

    expect(diagnostics.inbounds).toHaveLength(1)
    expect(diagnostics.inbounds[0]).toMatchObject({
      tag: 'ebpf-in',
      state: 'running',
      dataPlane: 'tc',
      udpSessions: 7,
      lastError: '',
    })
    expect(diagnostics.inbounds[0].detail).toMatchObject({ tag: 'ebpf-in', udpSessionCount: '7' })
    expect(diagnostics.kernelRuntime).toMatchObject({ programsError: 'denied' })
  })

  it('keeps bypass rule-set backend states and optional timestamps in the detail json', () => {
    const diagnostics = toEbpfDiagnostics(
      create(EBPFDiagnosticsResponseSchema, {
        inbounds: [
          {
            tag: 'ebpf-in',
            lastErrorAt: 0n,
            lastRecoveryAt: 1700000000n,
            nextRetryAt: 1700000060n,
            localBypassRuleSet: {
              backendState: {
                tc: { version: 3n, known: true },
                xdp: { version: 0n, known: false },
              },
            },
          },
        ],
      }),
    )

    expect(diagnostics.inbounds[0].detail).toMatchObject({
      lastErrorAt: '0',
      lastRecoveryAt: '1700000000',
      nextRetryAt: '1700000060',
      localBypassRuleSet: { backendState: { tc: { version: '3', known: true }, xdp: {} } },
    })
    expect(diagnostics.kernelRuntime).toBeUndefined()
  })
})
