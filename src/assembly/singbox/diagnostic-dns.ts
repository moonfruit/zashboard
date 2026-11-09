import { core, Core } from '@/assembly/backend'
import { queryDNS } from '@/assembly/config'
import type { DNSQueryParams } from '@/types'

export const queryDiagnosticDNS = (params: DNSQueryParams) =>
  queryDNS({ ...params, ...(core.value === Core.Singbox ? { skipFakeIP: true } : {}) })
