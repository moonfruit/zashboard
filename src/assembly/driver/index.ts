import { core, Core } from '@/assembly/backend'
import { singboxApi } from '@/assembly/singbox/api/state'
import { activeBackend } from '@/store/setup'
import type { Backend, BackendType } from '@/types'
import { clashDriver } from './clash'
import { daeDriver } from './dae'
import { singboxDriver } from './singbox'
import { singboxApiDriver } from './singbox-api'
import type { Driver } from './types'

const drivers: Record<BackendType, Driver> = {
  clash: clashDriver,
  dae: daeDriver,
}

export const driverFor = (backend?: Backend | null) =>
  drivers[backend?.type as BackendType] ?? clashDriver

export const driver = () => {
  const selected = driverFor(activeBackend.value)

  if (selected !== clashDriver || core.value !== Core.Singbox) return selected

  return singboxApi.value ? singboxApiDriver : singboxDriver
}

export * from './types'
