import { core, Core } from '@/assembly/backend'
import { clashDriver } from '@/assembly/driver/clash'
import { singboxVariant } from '@/assembly/singbox/variant'
import { probeActiveBackend } from '@/assembly/version'
import { checkUpgradeCore } from '@/store/settings'
import { backendList, setActiveBackend } from '@/store/setup'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clashBackend = {
  type: 'clash' as const,
  protocol: 'http',
  host: '127.0.0.1',
  port: '9090',
  secondaryPath: '',
  password: '',
  uuid: 'clash-backend',
}

const probe = async (version: string) => {
  vi.spyOn(clashDriver.system, 'fetchVersion').mockResolvedValue(version)
  await probeActiveBackend()
}

beforeEach(() => {
  vi.restoreAllMocks()
  checkUpgradeCore.value = false
  backendList.value = [clashBackend]
  setActiveBackend(clashBackend.uuid)
})

describe('core detection', () => {
  it.each([
    ['sing-box 1.14.1', Core.Singbox, 'official'],
    ['sing-box 1.15.0-alpha.6-reF1nd', Core.Singbox, 'refind'],
    ['sing-box 1.15.0-alpha.6-reF1nd.2-moonfruit.2', Core.Singbox, 'moonfruit'],
    ['v1.19.0', Core.Mihomo, undefined],
    ['honk 0.3.0', Core.Honk, undefined],
  ])('%s → %s / %s', async (version, expectedCore, expectedVariant) => {
    await probe(version)

    expect(core.value).toBe(expectedCore)
    expect(singboxVariant.value).toBe(expectedVariant)
  })

  it('drops variant when the next backend is not sing-box', async () => {
    await probe('sing-box 1.15.0-alpha.6-reF1nd')
    await probe('v1.19.0')

    expect(core.value).toBe(Core.Mihomo)
    expect(singboxVariant.value).toBeUndefined()
  })
})
