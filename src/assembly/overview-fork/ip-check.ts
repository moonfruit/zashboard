import { getIPInfo, getPublicIPInfo, type IPInfo } from '@/api/geoip'
import { useStorage } from '@/composables/use-storage'
import { IP_INFO_API } from '@/constant'
import type { IPCheckResult } from '@/helper/overview'
import * as ipaddr from 'ipaddr.js'
import { ref } from 'vue'

export const TRACE_IP_CHECK_HOSTS = [
  '64.ipcheck.ing',
  '4.ipcheck.ing',
  '6.ipcheck.ing',
  'ptest-1.ipcheck.ing',
  'ptest-2.ipcheck.ing',
  'ptest-3.ipcheck.ing',
  'ptest-4.ipcheck.ing',
  'ptest-5.ipcheck.ing',
  'ptest-6.ipcheck.ing',
  'ptest-7.ipcheck.ing',
  'ptest-8.ipcheck.ing',
] as const

export type TraceIPCheckHost = (typeof TRACE_IP_CHECK_HOSTS)[number]
export type IPCheckAPI = IP_INFO_API | TraceIPCheckHost

export const isTraceIPCheckHost = (api: string): api is TraceIPCheckHost =>
  (TRACE_IP_CHECK_HOSTS as readonly string[]).includes(api)

export const ipCheckAPIOptions = [...Object.values(IP_INFO_API), ...TRACE_IP_CHECK_HOSTS].map(
  (value) => ({ value, label: value }),
)

export const parseTrace = (text: string) =>
  Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      }),
  ) as Record<string, string | undefined>

const getTrace = async (host: TraceIPCheckHost) => {
  const response = await fetch(`https://${host}/cdn-cgi/trace`, { cache: 'no-store' })

  if (!response.ok) {
    throw new Error(`${host} trace failed: ${response.status}`)
  }

  const trace = parseTrace(await response.text())

  if (!trace.ip || !ipaddr.isValid(trace.ip)) {
    throw new Error(`${host} returned an invalid public IP`)
  }

  return { ip: trace.ip, loc: trace.loc ?? '', colo: trace.colo ?? '' }
}

export const getTraceIPInfo = async (host: TraceIPCheckHost): Promise<IPInfo> => {
  const trace = await getTrace(host)

  try {
    const info = await getIPInfo(trace.ip)
    return { ...info, ip: trace.ip, country: info.country || trace.loc }
  } catch {
    return {
      ip: trace.ip,
      country: trace.loc,
      region: '',
      city: '',
      asn: '',
      organization: trace.colo,
      latitude: null,
      longitude: null,
    }
  }
}

export const getIPCheckInfo = (api: IPCheckAPI) =>
  isTraceIPCheckHost(api) ? getTraceIPInfo(api) : getPublicIPInfo(api)

const emptyResult = (): IPCheckResult => ({ api: null, ip: [], ipWithPrivacy: [], info: null })

export const ipCheckTertiaryAPI = useStorage<IPCheckAPI>(
  'config/ip-check-tertiary-api',
  'ptest-1.ipcheck.ing',
)
export const ipCheckTertiaryResult = ref<IPCheckResult>(emptyResult())

export const forkIPCheckSlots = [
  { key: 'tertiary', api: ipCheckTertiaryAPI, result: ipCheckTertiaryResult },
]
