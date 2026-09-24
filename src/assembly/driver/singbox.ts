import { normalizeSingboxLog } from '@/assembly/singbox/logs'
import { clashDriver } from './clash'
import type { Driver } from './types'

export const singboxDriver: Driver = {
  ...clashDriver,
  logs: {
    subscribe: (level, onBatch) =>
      clashDriver.logs.subscribe(level, (batch) => onBatch(batch.map(normalizeSingboxLog))),
  },
}
