import { can } from '@/assembly/backend'
import { CONNECTIONS_TABLE_ACCESSOR_KEY } from '@/constant'
import { watch } from 'vue'

const SINGBOX_API_KEYS = new Set<CONNECTIONS_TABLE_ACCESSOR_KEY>([
  CONNECTIONS_TABLE_ACCESSOR_KEY.Protocol,
  CONNECTIONS_TABLE_ACCESSOR_KEY.Inbound,
  CONNECTIONS_TABLE_ACCESSOR_KEY.FromOutbound,
  CONNECTIONS_TABLE_ACCESSOR_KEY.OutboundType,
])

export const isConnectionKeyAvailable = (key: CONNECTIONS_TABLE_ACCESSOR_KEY) => {
  if (SINGBOX_API_KEYS.has(key)) return can('singboxApi')
  return true
}

export const restConnectionKeys = (used: CONNECTIONS_TABLE_ACCESSOR_KEY[]) =>
  Object.values(CONNECTIONS_TABLE_ACCESSOR_KEY).filter(
    (key) => !used.includes(key) && isConnectionKeyAvailable(key),
  )

export const onConnectionKeysChange = (callback: () => void) =>
  watch(() => can('singboxApi'), callback)
