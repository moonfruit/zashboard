import type { Cap } from '@/assembly/backend'
import { singboxCaps } from '@/assembly/singbox/capabilities'
import type { SingboxVariant } from '@/assembly/singbox/variant'
import { describe, expect, it } from 'vitest'

const REFIND_ONLY: Cap[] = [
  'coreRestart',
  'reloadConfigs',
  'proxyProviderUpdate',
  'proxyProviderHealthCheck',
  'ruleProviders',
]
const ALWAYS: Cap[] = [
  'dashboardUpgrade',
  'independentLatency',
  'traceLogLevel',
  'extraLogLevels',
  'customGlobalNode',
  'logTypeFilter',
  'logConnectionDetail',
  'disconnectOnModeChange',
  'modeSwitch',
  'latencyTest',
  'nodeLatencyTest',
  'customTestUrl',
  'dnsQuery',
  'flushDNSCache',
  'flushFakeIP',
  'connectionsClose',
]
const NEVER: Cap[] = ['coreUpdateCheck', 'configPatch', 'runtimeStats', 'silentLogLevel']
const OVERRIDE_ONLY: Cap[] = ['coreUpgrade', 'updateConfigs', 'updateGeoDatabase', 'syncSettings']

describe('singboxCaps', () => {
  it.each<SingboxVariant>(['official', 'refind', 'moonfruit'])('%s matrix', (variant) => {
    const caps = singboxCaps(variant, false)

    for (const cap of ALWAYS) expect(caps[cap], cap).toBe(true)
    for (const cap of REFIND_ONLY) expect(caps[cap] === true, cap).toBe(variant !== 'official')
    for (const cap of [...NEVER, ...OVERRIDE_ONLY]) expect(caps[cap], cap).not.toBe(true)
  })

  it('forkOverride unlocks the mihomoOrForkCore group only', () => {
    const caps = singboxCaps('official', true)

    for (const cap of [...OVERRIDE_ONLY, 'coreRestart', 'reloadConfigs'] as Cap[]) {
      expect(caps[cap], cap).toBe(true)
    }
    for (const cap of [
      'proxyProviderUpdate',
      'proxyProviderHealthCheck',
      'ruleProviders',
      ...NEVER,
    ] as Cap[]) {
      expect(caps[cap], cap).not.toBe(true)
    }
  })
})
