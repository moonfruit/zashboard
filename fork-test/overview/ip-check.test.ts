import * as geoip from '@/api/geoip'
import {
  getIPCheckInfo,
  getTraceIPInfo,
  ipCheckAPIOptions,
  isTraceIPCheckHost,
  parseTrace,
} from '@/assembly/overview-fork/ip-check'
import { IP_INFO_API } from '@/constant'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const TRACE = 'fl=1\nh=ptest-1.ipcheck.ing\nip=203.0.113.7\nts=1\ncolo=NRT\nloc=JP\n'

const lookup: geoip.IPInfo = {
  ip: '203.0.113.7',
  country: 'Japan',
  region: 'Tokyo',
  city: 'Tokyo',
  asn: '64500',
  organization: 'Example Cloud',
  latitude: 35.6,
  longitude: 139.7,
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('parseTrace', () => {
  it('parses key=value lines and keeps "=" inside values', () => {
    expect(parseTrace('ip=1.2.3.4\nuag=a=b\n\ninvalid\n')).toEqual({ ip: '1.2.3.4', uag: 'a=b' })
  })
})

describe('trace hosts', () => {
  it('recognises the eleven trace hosts', () => {
    expect(isTraceIPCheckHost('ptest-1.ipcheck.ing')).toBe(true)
    expect(isTraceIPCheckHost('ptest-8.ipcheck.ing')).toBe(true)
    expect(isTraceIPCheckHost('4.ipcheck.ing')).toBe(true)
    expect(isTraceIPCheckHost('6.ipcheck.ing')).toBe(true)
    expect(isTraceIPCheckHost('64.ipcheck.ing')).toBe(true)
    expect(isTraceIPCheckHost('ptest-9.ipcheck.ing')).toBe(false)
    expect(isTraceIPCheckHost(IP_INFO_API.IPSB)).toBe(false)
  })

  it('lists the built-in APIs first, then the trace hosts', () => {
    const values = ipCheckAPIOptions.map((option) => option.value)
    expect(values).toEqual([
      ...Object.values(IP_INFO_API),
      '64.ipcheck.ing',
      '4.ipcheck.ing',
      '6.ipcheck.ing',
      ...Array.from({ length: 8 }, (_, i) => `ptest-${i + 1}.ipcheck.ing`),
    ])
  })
})

describe('getTraceIPInfo', () => {
  it('reads the trace and enriches it with the global GeoIP lookup', async () => {
    fetchMock.mockResolvedValue(new Response(TRACE))
    const getIPInfo = vi.spyOn(geoip, 'getIPInfo').mockResolvedValue(lookup)

    await expect(getTraceIPInfo('ptest-1.ipcheck.ing')).resolves.toEqual(lookup)
    expect(fetchMock).toHaveBeenCalledWith('https://ptest-1.ipcheck.ing/cdn-cgi/trace', {
      cache: 'no-store',
    })
    expect(getIPInfo).toHaveBeenCalledWith('203.0.113.7')
  })

  it('falls back to the trace location when the lookup has no country', async () => {
    fetchMock.mockResolvedValue(new Response(TRACE))
    vi.spyOn(geoip, 'getIPInfo').mockResolvedValue({ ...lookup, country: '' })

    await expect(getTraceIPInfo('ptest-1.ipcheck.ing')).resolves.toMatchObject({ country: 'JP' })
  })

  it('falls back to loc and colo when the lookup fails', async () => {
    fetchMock.mockResolvedValue(new Response(TRACE))
    vi.spyOn(geoip, 'getIPInfo').mockRejectedValue(new Error('down'))

    await expect(getTraceIPInfo('ptest-1.ipcheck.ing')).resolves.toEqual({
      ip: '203.0.113.7',
      country: 'JP',
      region: '',
      city: '',
      asn: '',
      organization: 'NRT',
      latitude: null,
      longitude: null,
    })
  })

  it('rejects on HTTP errors and invalid IPs', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }))
    await expect(getTraceIPInfo('ptest-1.ipcheck.ing')).rejects.toThrow('403')

    fetchMock.mockResolvedValueOnce(new Response('ip=nope\n'))
    await expect(getTraceIPInfo('ptest-1.ipcheck.ing')).rejects.toThrow('invalid')
  })
})

describe('getIPCheckInfo', () => {
  it('routes built-in APIs to getPublicIPInfo', async () => {
    const getPublicIPInfo = vi.spyOn(geoip, 'getPublicIPInfo').mockResolvedValue(lookup)

    await expect(getIPCheckInfo(IP_INFO_API.IPSB)).resolves.toBe(lookup)
    expect(getPublicIPInfo).toHaveBeenCalledWith(IP_INFO_API.IPSB)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('routes trace hosts to the trace endpoint', async () => {
    fetchMock.mockResolvedValue(new Response(TRACE))
    vi.spyOn(geoip, 'getIPInfo').mockResolvedValue(lookup)
    const getPublicIPInfo = vi.spyOn(geoip, 'getPublicIPInfo')

    await getIPCheckInfo('64.ipcheck.ing')
    expect(fetchMock).toHaveBeenCalledWith('https://64.ipcheck.ing/cdn-cgi/trace', {
      cache: 'no-store',
    })
    expect(getPublicIPInfo).not.toHaveBeenCalled()
  })
})
