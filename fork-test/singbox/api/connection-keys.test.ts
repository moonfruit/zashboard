import { core, Core, resetCore } from '@/assembly/backend'
import { getConnectionDisplayValue } from '@/assembly/connections'
import { singboxApi } from '@/assembly/singbox/api/state'
import {
  isConnectionKeyAvailable,
  onConnectionKeysChange,
  restConnectionKeys,
} from '@/assembly/singbox/connection-keys'
import { singboxVariant } from '@/assembly/singbox/variant'
import { CONNECTIONS_TABLE_ACCESSOR_KEY as KEY, PROXY_CHAIN_DIRECTION } from '@/constant'
import { connectionCardGroupKey, effectiveConnectionCardGroupKey } from '@/store/connections'
import { backendList, setActiveBackend } from '@/store/setup'
import type { Connection, SingboxConnectionRawMessage } from '@/types'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

const backend = {
  type: 'clash' as const,
  protocol: 'http',
  host: '127.0.0.1',
  port: '9090',
  secondaryPath: '',
  password: '',
  uuid: 'keys',
}

const connection = {
  id: 'x',
  inbound: 'tun-in',
  inboundType: 'tun',
  ipVersion: 4,
  network: 'udp',
  source: '172.19.0.1:5000',
  destination: '1.1.1.1:443',
  domain: 'example.com',
  sniffHost: 'sniffed.example.com',
  protocol: 'quic',
  user: '',
  fromOutbound: 'dns-out',
  createdAt: 0,
  closedAt: 0,
  uplinkTotal: 0,
  downlinkTotal: 0,
  rule: '',
  outbound: 'proxy',
  outboundType: 'vless',
  chainList: ['proxy'],
  processPath: '',
  packageNames: [],
  downloadSpeed: 0,
  uploadSpeed: 0,
} as SingboxConnectionRawMessage & Connection

const options = {
  mode: 'table' as const,
  proxyChainDirection: PROXY_CHAIN_DIRECTION.NORMAL,
  showFullProxyChain: true,
}

beforeEach(() => {
  backendList.value = [backend]
  setActiveBackend(backend.uuid)
  resetCore()
  connectionCardGroupKey.value = null
})

describe('isConnectionKeyAvailable', () => {
  it('hides sing-box columns without the API', () => {
    core.value = Core.Singbox
    singboxVariant.value = 'refind'

    expect(isConnectionKeyAvailable(KEY.Protocol)).toBe(false)
    expect(isConnectionKeyAvailable(KEY.OutboundType)).toBe(false)
    expect(isConnectionKeyAvailable(KEY.SniffHost)).toBe(true)
    expect(isConnectionKeyAvailable(KEY.Host)).toBe(true)
  })

  it('shows sing-box columns and keeps SniffHost with the API', () => {
    core.value = Core.Singbox
    singboxVariant.value = 'moonfruit'
    singboxApi.value = { version: 'x', apiVersion: 5 }

    expect(isConnectionKeyAvailable(KEY.Protocol)).toBe(true)
    expect(isConnectionKeyAvailable(KEY.Inbound)).toBe(true)
    expect(isConnectionKeyAvailable(KEY.FromOutbound)).toBe(true)
    expect(isConnectionKeyAvailable(KEY.OutboundType)).toBe(true)
    expect(isConnectionKeyAvailable(KEY.SniffHost)).toBe(true)
  })
})

describe('restConnectionKeys', () => {
  it('lists unused available keys and follows sing-box API availability', async () => {
    core.value = Core.Singbox
    singboxVariant.value = 'moonfruit'
    singboxApi.value = undefined
    let rest = restConnectionKeys([KEY.Host])
    const stop = onConnectionKeysChange(() => (rest = restConnectionKeys([KEY.Host])))

    expect(rest).not.toContain(KEY.Host)
    expect(rest).not.toContain(KEY.Protocol)
    expect(rest).toContain(KEY.SniffHost)

    singboxApi.value = { version: 'x', apiVersion: 5 }
    await nextTick()

    expect(rest).toContain(KEY.Protocol)
    expect(rest).toContain(KEY.SniffHost)
    stop()
  })
})

describe('display values', () => {
  it('reads the new columns through the sing-box accessor', () => {
    core.value = Core.Singbox
    singboxVariant.value = 'moonfruit'
    singboxApi.value = { version: 'x', apiVersion: 5 }

    expect(getConnectionDisplayValue(connection, KEY.Protocol, options)).toBe('quic')
    expect(getConnectionDisplayValue(connection, KEY.Inbound, options)).toBe('tun-in')
    expect(getConnectionDisplayValue(connection, KEY.FromOutbound, options)).toBe('dns-out')
    expect(getConnectionDisplayValue(connection, KEY.OutboundType, options)).toBe('vless')
    expect(getConnectionDisplayValue(connection, KEY.SniffHost, options)).toBe(
      'sniffed.example.com',
    )
  })
})

describe('effectiveConnectionCardGroupKey', () => {
  it('resolves a hidden group key to null without the sing-box API', () => {
    core.value = Core.Singbox
    singboxVariant.value = 'moonfruit'
    singboxApi.value = undefined
    connectionCardGroupKey.value = KEY.Protocol

    expect(effectiveConnectionCardGroupKey.value).toBe(null)
  })

  it('keeps an available group key unchanged without the sing-box API', () => {
    core.value = Core.Singbox
    singboxVariant.value = 'refind'
    connectionCardGroupKey.value = KEY.SniffHost

    expect(effectiveConnectionCardGroupKey.value).toBe(KEY.SniffHost)
  })
})
