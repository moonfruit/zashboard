import { singboxApiStatus } from '@/assembly/singbox/api-status'
import { resetSingboxApi, singboxApi, singboxApiModule } from '@/assembly/singbox/api/state'
import type { StreamPhase } from '@/assembly/singbox/api/stream'
import { singboxVariant } from '@/assembly/singbox/variant'
import { beforeEach, describe, expect, it } from 'vitest'
import { ref, shallowRef } from 'vue'
import { installRuntime } from './fake-runtime'

const stream = (phase: StreamPhase = 'active', error?: unknown) => ({
  phase: ref<StreamPhase>(phase),
  error: shallowRef<unknown>(error),
})

const streams = () => ({
  statusStream: stream(),
  connectionsStream: stream(),
  logStream: stream(),
  groupsStream: stream(),
  clashModeStream: stream(),
})

beforeEach(() => {
  resetSingboxApi()
  singboxApiModule.value = undefined
  singboxVariant.value = 'moonfruit'
  singboxApi.value = { version: 'x', apiVersion: 5 }
})

describe('singboxApiStatus reconnecting', () => {
  it('stays connected while streams are active, idle or first connecting', () => {
    const runtime = streams()

    runtime.logStream.phase.value = 'idle'
    runtime.groupsStream.phase.value = 'connecting'
    installRuntime(runtime)

    expect(singboxApiStatus.value).toEqual({ state: 'connected', apiVersion: 5 })
  })

  it('reports reconnecting when a stream retries after an error', () => {
    const runtime = streams()

    installRuntime(runtime)
    runtime.statusStream.phase.value = 'connecting'
    runtime.statusStream.error.value = new Error('websocket closed')

    expect(singboxApiStatus.value).toEqual({ state: 'reconnecting' })

    runtime.statusStream.phase.value = 'active'
    runtime.statusStream.error.value = undefined

    expect(singboxApiStatus.value).toEqual({ state: 'connected', apiVersion: 5 })
  })

  it('ignores stream state before the API is probed', () => {
    const runtime = streams()

    runtime.statusStream.phase.value = 'connecting'
    runtime.statusStream.error.value = new Error('x')
    installRuntime(runtime)
    singboxApi.value = undefined

    expect(singboxApiStatus.value).toBeUndefined()
  })
})
