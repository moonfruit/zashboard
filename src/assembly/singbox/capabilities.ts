import type { Cap } from '../backend'
import type { SingboxVariant } from './variant'

export const singboxCaps = (
  variant: SingboxVariant,
  forkOverride: boolean,
): Partial<Record<Cap, boolean>> => {
  const refind = variant !== 'official'

  return {
    coreUpgrade: forkOverride,
    coreRestart: refind || forkOverride,
    dashboardUpgrade: true,
    reloadConfigs: refind || forkOverride,
    updateConfigs: forkOverride,
    updateGeoDatabase: forkOverride,
    syncSettings: forkOverride,
    independentLatency: true,

    traceLogLevel: true,
    silentLogLevel: true,
    extraLogLevels: true,

    customGlobalNode: true,
    logTypeFilter: true,
    logConnectionDetail: true,
    disconnectOnModeChange: true,

    latencyTest: true,
    proxyProviderUpdate: refind,
    proxyProviderHealthCheck: refind,
    ruleProviders: refind,
    flushDNSCache: true,
    flushFakeIP: true,
    dnsQuery: true,
    connectionsClose: true,
    customTestUrl: true,
    nodeLatencyTest: true,
  }
}
