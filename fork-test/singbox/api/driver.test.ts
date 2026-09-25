import { can, core, Core, resetCore } from '@/assembly/backend'
import { driver } from '@/assembly/driver'
import { singboxDriver } from '@/assembly/driver/singbox'
import { singboxApiDriver } from '@/assembly/driver/singbox-api'
import { singboxApi, singboxApiError, singboxRuntime } from '@/assembly/singbox/api/state'
import { singboxVariant } from '@/assembly/singbox/variant'
import { backendList, setActiveBackend } from '@/store/setup'
import { beforeEach, describe, expect, it } from 'vitest'

const backend = {
  type: 'clash' as const,
  protocol: 'http',
  host: '127.0.0.1',
  port: '9090',
  secondaryPath: '',
  password: '',
  uuid: 'api-backend',
}

beforeEach(() => {
  backendList.value = [backend]
  setActiveBackend(backend.uuid)
  resetCore()
})

describe('sing-box API driver selection', () => {
  it('uses the API driver only when the API was probed', () => {
    core.value = Core.Singbox
    singboxVariant.value = 'moonfruit'
    expect(driver()).toBe(singboxDriver)

    singboxApi.value = { version: '1.15.0-moonfruit', apiVersion: 5 }
    expect(driver()).toBe(singboxApiDriver)
    expect(can('singboxApi')).toBe(true)
    expect(can('ebpfDiagnostics')).toBe(true)
  })

  it('ignores the API on other cores', () => {
    core.value = Core.Mihomo
    singboxApi.value = { version: 'x', apiVersion: 5 }
    expect(driver()).not.toBe(singboxApiDriver)
    expect(can('singboxApi')).toBe(false)
  })

  it('resetCore clears API state', () => {
    singboxApi.value = { version: 'x', apiVersion: 5 }
    singboxApiError.value = 'unauthorized'
    singboxRuntime.value = { startedAt: 1, goroutines: 1, connectionsIn: 1, connectionsOut: 1 }

    resetCore()

    expect(singboxApi.value).toBeUndefined()
    expect(singboxApiError.value).toBeUndefined()
    expect(singboxRuntime.value).toBeUndefined()
  })
})
