import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { singboxCaps } from '../src/assembly/singbox/capabilities.ts'
import { getLogConnectionID, getSingboxLogType } from '../src/assembly/singbox/logs.ts'
import { detectSingboxVariant } from '../src/assembly/singbox/variant.ts'

describe('detectSingboxVariant', () => {
  it('official', () => {
    assert.equal(detectSingboxVariant('sing-box 1.14.1'), 'official')
    assert.equal(detectSingboxVariant('sing-box 1.14.0-beta.17'), 'official')
  })

  it('refind', () => {
    assert.equal(detectSingboxVariant('sing-box 1.15.0-alpha.6-reF1nd'), 'refind')
    assert.equal(detectSingboxVariant('sing-box 1.15.0-alpha.6-reF1nd.2'), 'refind')
    assert.equal(detectSingboxVariant('sing-box 1.15.0-alpha.6-ref1nd'), 'refind')
  })

  it('moonfruit', () => {
    assert.equal(detectSingboxVariant('sing-box 1.15.0-alpha.6-reF1nd-moonfruit'), 'moonfruit')
    assert.equal(detectSingboxVariant('sing-box 1.15.0-alpha.6-reF1nd.2-moonfruit.2'), 'moonfruit')
  })
})

describe('singboxCaps', () => {
  const REFIND_ONLY = [
    'coreRestart',
    'reloadConfigs',
    'proxyProviderUpdate',
    'proxyProviderHealthCheck',
    'ruleProviders',
  ]
  const ALWAYS = [
    'dashboardUpgrade',
    'independentLatency',
    'traceLogLevel',
    'silentLogLevel',
    'extraLogLevels',
    'customGlobalNode',
    'logTypeFilter',
    'logConnectionDetail',
    'disconnectOnModeChange',
    'latencyTest',
    'nodeLatencyTest',
    'customTestUrl',
    'dnsQuery',
    'flushDNSCache',
    'flushFakeIP',
    'connectionsClose',
  ]
  const NEVER = ['coreUpdateCheck', 'configPatch', 'runtimeStats']
  const OVERRIDE_ONLY = ['coreUpgrade', 'updateConfigs', 'updateGeoDatabase', 'syncSettings']

  for (const variant of ['official', 'refind', 'moonfruit']) {
    it(`${variant} matrix`, () => {
      const caps = singboxCaps(variant, false)

      for (const cap of ALWAYS) assert.equal(caps[cap], true, cap)
      for (const cap of REFIND_ONLY) assert.equal(caps[cap] === true, variant !== 'official', cap)
      for (const cap of [...NEVER, ...OVERRIDE_ONLY]) assert.notEqual(caps[cap], true, cap)
    })
  }

  it('forkOverride unlocks the mihomoOrForkCore group only', () => {
    const caps = singboxCaps('official', true)

    for (const cap of [...OVERRIDE_ONLY, 'coreRestart', 'reloadConfigs']) {
      assert.equal(caps[cap], true, cap)
    }
    for (const cap of [
      'proxyProviderUpdate',
      'proxyProviderHealthCheck',
      'ruleProviders',
      ...NEVER,
    ]) {
      assert.notEqual(caps[cap], true, cap)
    }
  })
})

describe('sing-box log parsing', () => {
  it('extracts tag type with connection prefix', () => {
    assert.equal(getSingboxLogType('[3829292130 5ms] router: match[0] => direct'), 'router:')
  })

  it('extracts tag type without connection prefix', () => {
    assert.equal(getSingboxLogType('inbound/tun[tun-in]: started at utun9'), 'inbound/tun[tun-in]:')
  })

  it('returns empty type when no tag', () => {
    assert.equal(getSingboxLogType('sing-box started (0.12s)'), '')
    assert.equal(getSingboxLogType('[42 1ms] closed'), '')
  })

  it('extracts connection id', () => {
    assert.equal(getLogConnectionID('[3829292130 5ms] router: match[0]'), '3829292130')
    assert.equal(getLogConnectionID('[3829292130 1.2s] outbound/vless[proxy]: x'), '3829292130')
  })

  it('returns null without connection prefix', () => {
    assert.equal(getLogConnectionID('router: updated'), null)
    assert.equal(getLogConnectionID('[warn] something'), null)
  })
})
