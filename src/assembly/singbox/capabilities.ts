import type { Cap } from '../backend'
import type { SingboxVariant } from './variant'

export type SingboxApiCaps = {
  apiVersion: number
}

export const singboxCaps = (
  variant: SingboxVariant,
  forkOverride: boolean,
  api?: SingboxApiCaps,
): Partial<Record<Cap, boolean>> => {
  const refind = variant !== 'official'
  const apiVersion = api?.apiVersion ?? 0

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
    extraLogLevels: true,

    customGlobalNode: true,
    logTypeFilter: true,
    logConnectionDetail: true,
    disconnectOnModeChange: true,
    modeSwitch: true,

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

    singboxApi: !!api,
    tools: !!api,
    backendEvents: !!api,
    tailscale: !!api && apiVersion >= 3,
    openvpn: !!api && apiVersion >= 3,
    openconnect: !!api && apiVersion >= 3,
    ebpfDiagnostics: !!api && apiVersion >= 5,
  }
}
