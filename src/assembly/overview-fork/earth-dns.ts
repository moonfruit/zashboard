import { core, Core } from '@/assembly/backend'
import { queryDNS } from '@/assembly/config'
import { activeBackend } from '@/store/setup'
import { watch } from 'vue'
import { createDNSResolver } from './dns-resolver'

export const createEarthDNSResolver = () => {
  let resolver: ReturnType<typeof createDNSResolver> | undefined
  let disposed = false
  const reset = () => {
    resolver?.dispose()
    resolver = undefined
  }
  const unwatch = watch(
    () => {
      const backend = activeBackend.value
      return [
        core.value,
        backend?.uuid,
        backend?.type,
        backend?.protocol,
        backend?.host,
        backend?.port,
        backend?.secondaryPath,
        backend?.password,
      ]
    },
    reset,
    { flush: 'sync' },
  )

  return {
    resolve(hostnames: string[]) {
      if (disposed || !activeBackend.value) return Promise.resolve({})
      const skipFakeIP = core.value === Core.Singbox
      resolver ??= createDNSResolver(
        (name, type, signal) =>
          queryDNS({ name, type, ...(skipFakeIP ? { skipFakeIP } : {}) }, signal),
        skipFakeIP,
      )
      return resolver.resolve(hostnames)
    },
    dispose() {
      disposed = true
      unwatch()
      reset()
    },
  }
}
