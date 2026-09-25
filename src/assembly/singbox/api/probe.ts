import { activeBackend } from '@/store/setup'
import type { Backend } from '@/types'
import { watch } from 'vue'
import type { ProbeResult } from './client'
import { endpointOf } from './endpoint'
import {
  singboxApi,
  singboxApiError,
  singboxApiModule,
  singboxRuntime,
  type SingboxApiError,
} from './state'

export const PROBE_RETRY_MS = 3000

type Runtime = typeof import('./runtime')
type Success = Extract<ProbeResult, { ok: true }>

let generation = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined
let restart: (() => unknown) | undefined
let disabled: { uuid: string; reason: SingboxApiError } | undefined
let recovered: { uuid: string; runtime: Runtime; result: Success } | undefined

watch(activeBackend, () => {
  disabled = undefined
})

export const onSingboxApiRestart = (hook: () => unknown) => {
  restart = hook
}

const apply = (runtime: Runtime, result: Success) => {
  singboxApiModule.value = runtime
  singboxRuntime.value = {
    startedAt: result.startedAt,
    goroutines: 0,
    connectionsIn: 0,
    connectionsOut: 0,
  }
  singboxApiError.value = undefined
  singboxApi.value = result.info
}

const attempt = async (backend: Backend) => {
  const runtime = await import('./runtime')

  return { runtime, result: await runtime.probe(endpointOf(backend)) }
}

const isCurrent = (backend: Backend, current: number) =>
  current === generation && activeBackend.value?.uuid === backend.uuid

const scheduleRetry = (backend: Backend, current: number) => {
  retryTimer = setTimeout(async () => {
    if (!isCurrent(backend, current)) return

    const outcome = await attempt(backend).catch(() => undefined)

    if (!outcome?.result.ok || !isCurrent(backend, current)) return

    recovered = { uuid: backend.uuid, runtime: outcome.runtime, result: outcome.result }
    try {
      await restart?.()
    } finally {
      recovered = undefined
    }
  }, PROBE_RETRY_MS)
}

export const probeSingboxApi = async (backend: Backend) => {
  const current = ++generation

  clearTimeout(retryTimer)
  if (disabled?.uuid === backend.uuid) {
    singboxApiError.value = disabled.reason
    return
  }
  if (backend.secondaryPath) {
    singboxApiError.value = 'subpath'
    return
  }
  const reuse = recovered?.uuid === backend.uuid ? recovered : undefined

  recovered = undefined
  if (reuse) {
    apply(reuse.runtime, reuse.result)
    return
  }

  try {
    const { runtime, result } = await attempt(backend)

    if (!isCurrent(backend, current)) return
    if (result.ok) {
      apply(runtime, result)
      return
    }

    singboxApiError.value = result.error
    if (result.error === 'timeout' || result.error === 'network') scheduleRetry(backend, current)
  } catch {
    if (!isCurrent(backend, current)) return
    singboxApiError.value = 'network'
    scheduleRetry(backend, current)
  }
}

export const fallBackToClash = (reason: SingboxApiError) => {
  const backend = activeBackend.value

  if (!backend) return
  if (reason !== 'unauthorized') disabled = { uuid: backend.uuid, reason }
  singboxApi.value = undefined
  singboxApiError.value = reason
  restart?.()
}
