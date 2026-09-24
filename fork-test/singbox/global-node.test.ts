import { core, Core, resetCore } from '@/assembly/backend'
import { proxyGroupList, proxyMap } from '@/assembly/proxies/state'
import {
  customGlobalNode,
  customGlobalNodeOptions,
  effectiveGlobalNode,
} from '@/assembly/singbox/global-node'
import { GLOBAL } from '@/constant'
import { backendList, setActiveBackend } from '@/store/setup'
import type { Proxy } from '@/types'
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

const group = (name: string) => ({ name, type: 'Selector', all: ['node-a'] }) as unknown as Proxy
const node = (name: string) => ({ name, type: 'Vmess' }) as unknown as Proxy

beforeEach(() => {
  backendList.value = [clashBackend]
  setActiveBackend(clashBackend.uuid)
  resetCore()
  core.value = Core.Singbox
  proxyMap.value = {
    [GLOBAL]: group(GLOBAL),
    'group-a': group('group-a'),
    'group-b': group('group-b'),
    'node-a': node('node-a'),
  }
  proxyGroupList.value = ['group-a', 'group-b']
  customGlobalNode.value = GLOBAL
})

describe('customGlobalNodeOptions', () => {
  it('lists GLOBAL first followed by groups, excluding nodes', () => {
    expect(customGlobalNodeOptions.value).toEqual([GLOBAL, 'group-a', 'group-b'])
  })

  it('omits GLOBAL when the core does not provide it', () => {
    delete proxyMap.value[GLOBAL]
    proxyMap.value = { ...proxyMap.value }

    expect(customGlobalNodeOptions.value).toEqual(['group-a', 'group-b'])
  })
})

describe('effectiveGlobalNode', () => {
  it('uses the stored group when it exists', () => {
    customGlobalNode.value = 'group-b'

    expect(effectiveGlobalNode.value).toBe('group-b')
  })

  it('falls back to GLOBAL when the stored name is missing', () => {
    customGlobalNode.value = 'missing'

    expect(effectiveGlobalNode.value).toBe(GLOBAL)
  })

  it('keeps the stored name while falling back', () => {
    customGlobalNode.value = 'missing'
    void effectiveGlobalNode.value

    expect(customGlobalNode.value).toBe('missing')
  })

  it('writes the selection back to storage', () => {
    effectiveGlobalNode.value = 'group-a'

    expect(customGlobalNode.value).toBe('group-a')
  })

  it('ignores the stored name on cores without the capability', () => {
    customGlobalNode.value = 'group-b'
    core.value = Core.Mihomo

    expect(effectiveGlobalNode.value).toBe(GLOBAL)
  })
})
