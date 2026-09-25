import { fetchConfigs } from '@/assembly/config'
import { fetchProxies } from '@/assembly/proxies'
import { debounce } from 'lodash'

const REFRESH_DEBOUNCE = 400

const refreshProxies = debounce(() => {
  fetchProxies().catch(() => {})
}, REFRESH_DEBOUNCE)

const refreshConfigs = debounce(() => {
  fetchConfigs().catch(() => {})
}, REFRESH_DEBOUNCE)

export const handleSingboxEvent = (kind: string) => {
  if (kind === 'proxies.changed') refreshProxies()
  else if (kind === 'configs.changed') refreshConfigs()
}

export const cancelSingboxRefresh = () => {
  refreshProxies.cancel()
  refreshConfigs.cancel()
}
