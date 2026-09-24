import { can } from '@/assembly/backend'
import { updateConfigs } from '@/assembly/config'
import { activeConnections, connectionAccessor, disconnectById } from '@/assembly/connections'
import { automaticDisconnection } from '@/store/settings'

export const changeMode = async (mode: string) => {
  await updateConfigs({ mode })

  if (!can('disconnectOnModeChange') || !automaticDisconnection.value) return

  const accessor = connectionAccessor()

  activeConnections.value.forEach((connection) => {
    if (accessor.rule(connection).includes('clash_mode')) {
      disconnectById(connection.id).catch(() => {})
    }
  })
}
