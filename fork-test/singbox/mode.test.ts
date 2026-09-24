import { core, Core, resetCore } from '@/assembly/backend'
import { activeConnections } from '@/assembly/connections'
import { clashDriver } from '@/assembly/driver/clash'
import { changeMode } from '@/assembly/singbox/mode'
import { automaticDisconnection } from '@/store/settings'
import { backendList, setActiveBackend } from '@/store/setup'
import type { Connection } from '@/types'
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

const connection = (id: string, rule: string) =>
  ({ id, rule, rulePayload: '', chains: [], metadata: {} }) as unknown as Connection

const deferred = () => {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

let disconnect: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.restoreAllMocks()
  backendList.value = [clashBackend]
  setActiveBackend(clashBackend.uuid)
  resetCore()
  core.value = Core.Singbox
  automaticDisconnection.value = true
  activeConnections.value = [
    connection('a', 'clash_mode=global => route(proxy)'),
    connection('b', 'rule_set=GFW => route(proxy)'),
  ]
  vi.spyOn(clashDriver.config, 'fetch').mockResolvedValue({} as never)
  disconnect = vi.spyOn(clashDriver.connections, 'disconnect').mockResolvedValue()
})

describe('changeMode', () => {
  it('disconnects clash_mode connections only after the mode is patched', async () => {
    const patch = deferred()
    vi.spyOn(clashDriver.config, 'patch').mockReturnValue(patch.promise)

    const pending = changeMode('global')

    await Promise.resolve()
    expect(disconnect).not.toHaveBeenCalled()

    patch.resolve()
    await pending

    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledWith('a')
  })

  it('keeps connections when patching the mode fails', async () => {
    vi.spyOn(clashDriver.config, 'patch').mockRejectedValue(new Error('boom'))

    await expect(changeMode('global')).rejects.toThrow('boom')
    expect(disconnect).not.toHaveBeenCalled()
  })

  it('does not disconnect when automatic disconnection is off', async () => {
    automaticDisconnection.value = false
    vi.spyOn(clashDriver.config, 'patch').mockResolvedValue()

    await changeMode('global')

    expect(disconnect).not.toHaveBeenCalled()
  })

  it('does not disconnect on non sing-box cores', async () => {
    core.value = Core.Mihomo
    vi.spyOn(clashDriver.config, 'patch').mockResolvedValue()

    await changeMode('global')

    expect(disconnect).not.toHaveBeenCalled()
  })
})
