import { createClashWebSocket } from '@/api/clash'
import { clashDriver } from '@/assembly/driver/clash'
import { singboxDriver } from '@/assembly/driver/singbox'
import { normalizeSingboxLog } from '@/assembly/singbox/logs'
import { LOG_LEVEL } from '@/constant'
import type { Log } from '@/types'
import { describe, expect, it, vi } from 'vitest'
import { nextTick, shallowRef } from 'vue'

vi.mock('@/api/clash', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/clash')>()),
  createClashWebSocket: vi.fn(),
}))

const log = (type: string, payload = 'router: x') => ({ type, payload }) as Log

describe('normalizeSingboxLog', () => {
  it('renames warn to warning', () => {
    expect(normalizeSingboxLog(log('warn')).type).toBe(LOG_LEVEL.Warning)
  })

  it('keeps other levels untouched', () => {
    for (const level of ['trace', 'debug', 'info', 'error', 'fatal', 'panic']) {
      const input = log(level)

      expect(normalizeSingboxLog(input)).toBe(input)
    }
  })
})

describe('log level normalization scope', () => {
  const receivedTypes = async (subscribe: typeof clashDriver.logs.subscribe) => {
    const data = shallowRef<Log>()

    vi.mocked(createClashWebSocket).mockReturnValue({
      data,
      close: () => {},
    } as unknown as ReturnType<typeof createClashWebSocket>)

    const received: string[] = []
    const subscription = subscribe('info', (batch) =>
      received.push(...batch.map((item) => item.type)),
    )

    data.value = log('warn')
    await nextTick()
    data.value = log('info')
    await nextTick()
    subscription.close()

    return received
  }

  it('singbox driver delivers warning', async () => {
    expect(await receivedTypes(singboxDriver.logs.subscribe)).toEqual([
      LOG_LEVEL.Warning,
      LOG_LEVEL.Info,
    ])
  })

  it('clash driver passes warn through unchanged', async () => {
    expect(await receivedTypes(clashDriver.logs.subscribe)).toEqual(['warn', LOG_LEVEL.Info])
  })
})
