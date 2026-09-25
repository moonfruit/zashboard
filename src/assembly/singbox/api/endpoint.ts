import type { Backend } from '@/types'

export type SingboxEndpoint = {
  baseUrl: string
  secret: string
}

export const endpointOf = (
  backend: Pick<Backend, 'protocol' | 'host' | 'port' | 'password'>,
): SingboxEndpoint => ({
  baseUrl: `${backend.protocol}://${backend.host}:${backend.port}`,
  secret: backend.password,
})

export const websocketUrl = (endpoint: SingboxEndpoint, service: string, method: string) =>
  `${endpoint.baseUrl.replace(/^http/, 'ws')}/${service}/${method}`
