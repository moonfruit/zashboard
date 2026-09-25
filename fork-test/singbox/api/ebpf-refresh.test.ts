import { createEbpfRefresh } from '@/assembly/singbox/tools/availability'
import type { EbpfDiagnostics } from '@/assembly/singbox/tools/ebpf'
import { describe, expect, it } from 'vitest'

const diag = (tag: string): EbpfDiagnostics => ({
  inbounds: [{ tag, state: 'active', dataPlane: '', udpSessions: 0, lastError: '', detail: null }],
  kernelRuntime: undefined,
})

describe('createEbpfRefresh', () => {
  it('keeps the later-started refresh even if the earlier one resolves after it', async () => {
    const resolvers: ((value: EbpfDiagnostics) => void)[] = []
    const fetch = () => new Promise<EbpfDiagnostics>((resolve) => resolvers.push(resolve))

    const { ebpf, refresh } = createEbpfRefresh(fetch)

    const first = refresh(true, { reset: false })
    const second = refresh(true, { reset: false })

    resolvers[1](diag('second'))
    await second
    expect(ebpf.value?.inbounds[0].tag).toBe('second')

    resolvers[0](diag('first'))
    await first
    expect(ebpf.value?.inbounds[0].tag).toBe('second')
  })

  it('drops a stale error from an earlier refresh', async () => {
    const resolvers: { resolve: (value: EbpfDiagnostics) => void; reject: (e: unknown) => void }[] =
      []
    const fetch = () =>
      new Promise<EbpfDiagnostics>((resolve, reject) => resolvers.push({ resolve, reject }))

    const { ebpf, ebpfError, refresh } = createEbpfRefresh(fetch)

    const first = refresh(true, { reset: false })
    const second = refresh(true, { reset: false })

    resolvers[1].resolve(diag('second'))
    await second
    resolvers[0].reject(new Error('stale'))
    await first

    expect(ebpfError.value).toBe('')
    expect(ebpf.value?.inbounds[0].tag).toBe('second')
  })

  it('clears data and skips a stale resolution when disabled mid-flight', async () => {
    const resolvers: ((value: EbpfDiagnostics) => void)[] = []
    const fetch = () => new Promise<EbpfDiagnostics>((resolve) => resolvers.push(resolve))

    const { ebpf, ebpfLoading, refresh } = createEbpfRefresh(fetch)

    const first = refresh(true, { reset: false })
    await refresh(false, { reset: true })

    expect(ebpf.value).toBeUndefined()
    expect(ebpfLoading.value).toBe(false)

    resolvers[0](diag('late'))
    await first

    expect(ebpf.value).toBeUndefined()
    expect(ebpfLoading.value).toBe(false)
  })

  it('keeps the previous data visible while a manual refresh is in flight', async () => {
    const resolvers: ((value: EbpfDiagnostics) => void)[] = []
    const fetch = () => new Promise<EbpfDiagnostics>((resolve) => resolvers.push(resolve))

    const { ebpf, ebpfLoading, refresh } = createEbpfRefresh(fetch)

    const initial = refresh(true, { reset: true })
    resolvers[0](diag('initial'))
    await initial

    const manual = refresh(true, { reset: false })
    expect(ebpfLoading.value).toBe(true)
    expect(ebpf.value?.inbounds[0].tag).toBe('initial')

    resolvers[1](diag('manual'))
    await manual
    expect(ebpfLoading.value).toBe(false)
    expect(ebpf.value?.inbounds[0].tag).toBe('manual')
  })

  it('clears the previous data and error immediately on a reset refresh', async () => {
    const resolvers: { resolve: (value: EbpfDiagnostics) => void; reject: (e: unknown) => void }[] =
      []
    const fetch = () =>
      new Promise<EbpfDiagnostics>((resolve, reject) => resolvers.push({ resolve, reject }))

    const { ebpf, ebpfError, ebpfLoading, refresh } = createEbpfRefresh(fetch)

    const initial = refresh(true, { reset: true })
    resolvers[0].resolve(diag('initial'))
    await initial

    const failing = refresh(true, { reset: false })
    resolvers[1].reject(new Error('boom'))
    await failing
    expect(ebpfError.value).not.toBe('')
    expect(ebpf.value?.inbounds[0].tag).toBe('initial')

    const reset = refresh(true, { reset: true })
    expect(ebpf.value).toBeUndefined()
    expect(ebpfError.value).toBe('')
    expect(ebpfLoading.value).toBe(true)

    resolvers[2].resolve(diag('next'))
    await reset
    expect(ebpf.value?.inbounds[0].tag).toBe('next')
  })

  it('guards out-of-order manual refreshes without clearing the previous data', async () => {
    const resolvers: ((value: EbpfDiagnostics) => void)[] = []
    const fetch = () => new Promise<EbpfDiagnostics>((resolve) => resolvers.push(resolve))

    const { ebpf, ebpfLoading, refresh } = createEbpfRefresh(fetch)

    const initial = refresh(true, { reset: true })
    resolvers[0](diag('initial'))
    await initial

    const first = refresh(true, { reset: false })
    const second = refresh(true, { reset: false })
    expect(ebpf.value?.inbounds[0].tag).toBe('initial')

    resolvers[2](diag('second'))
    await second
    expect(ebpf.value?.inbounds[0].tag).toBe('second')
    expect(ebpfLoading.value).toBe(false)

    resolvers[1](diag('first'))
    await first
    expect(ebpf.value?.inbounds[0].tag).toBe('second')
    expect(ebpfLoading.value).toBe(false)
  })
})
