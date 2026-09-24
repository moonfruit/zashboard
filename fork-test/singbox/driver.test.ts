import { can, core, Core, resetCore } from '@/assembly/backend'
import { driver } from '@/assembly/driver'
import { clashDriver } from '@/assembly/driver/clash'
import { singboxDriver } from '@/assembly/driver/singbox'
import { singboxVariant } from '@/assembly/singbox/variant'
import { backendList, setActiveBackend } from '@/store/setup'
import { beforeEach, describe, expect, it } from 'vitest'

const clashBackend = {
  type: 'clash' as const,
  protocol: 'http',
  host: '127.0.0.1',
  port: '9090',
  secondaryPath: '',
  password: '',
  uuid: 'clash-backend',
}

beforeEach(() => {
  backendList.value = [clashBackend]
  setActiveBackend(clashBackend.uuid)
  resetCore()
})

describe('driver selection', () => {
  it('uses clash driver before core is detected', () => {
    expect(driver()).toBe(clashDriver)
  })

  it('uses singbox driver on sing-box core', () => {
    core.value = Core.Singbox
    expect(driver()).toBe(singboxDriver)
  })

  it('falls back to clash driver on mihomo core', () => {
    core.value = Core.Mihomo
    expect(driver()).toBe(clashDriver)
  })
})

describe('backend switch reset', () => {
  it('clears sing-box variant and capabilities', () => {
    core.value = Core.Singbox
    singboxVariant.value = 'refind'
    expect(can('coreRestart')).toBe(true)
    expect(can('proxyProviderUpdate')).toBe(true)

    resetCore()
    core.value = Core.Mihomo

    expect(singboxVariant.value).toBeUndefined()
    expect(can('customGlobalNode')).toBe(false)
    expect(can('coreUpgrade')).toBe(true)
  })
})
