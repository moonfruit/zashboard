import { language } from '@/store/settings'
import { activeBackend } from '@/store/setup'
import type { DescMessage, DescMethodServerStreaming, MessageInitShape } from '@bufbuild/protobuf'
import {
  Code,
  ConnectError,
  createClient,
  type Client,
  type Interceptor,
} from '@connectrpc/connect'
import { createGrpcWebTransport } from '@connectrpc/connect-web'
import { endpointOf, type SingboxEndpoint } from './endpoint'
import { StartedService } from './gen/daemon/started_service_pb'
import type { SingboxApiError, SingboxApiInfo } from './state'
import { wsServerStream } from './websocket'

export type StartedServiceClient = Client<typeof StartedService>

export type ProbeResult =
  { ok: true; info: SingboxApiInfo; startedAt: number } | { ok: false; error: SingboxApiError }

const headers =
  (secret: string): Interceptor =>
  (next) =>
  (request) => {
    request.header.set('Accept-Language', language.value)
    if (secret) request.header.set('Authorization', `Bearer ${secret}`)
    return next(request)
  }

export const createServiceClient = (endpoint: SingboxEndpoint): StartedServiceClient =>
  createClient(
    StartedService,
    createGrpcWebTransport({ baseUrl: endpoint.baseUrl, interceptors: [headers(endpoint.secret)] }),
  )

let cached: { key: string; client: StartedServiceClient } | undefined

export const activeEndpoint = (): SingboxEndpoint => {
  const backend = activeBackend.value

  if (!backend) throw new ConnectError('no active backend', Code.Unavailable)
  return endpointOf(backend)
}

export const api = (): StartedServiceClient => {
  const endpoint = activeEndpoint()
  const key = `${endpoint.baseUrl}|${endpoint.secret}`

  if (cached?.key !== key) cached = { key, client: createServiceClient(endpoint) }
  return cached.client
}

export const serverStream = <I extends DescMessage, O extends DescMessage>(
  method: DescMethodServerStreaming<I, O>,
  request: MessageInitShape<I>,
  signal: AbortSignal,
) =>
  wsServerStream(activeEndpoint(), method, request, signal, {
    headers: { 'accept-language': language.value },
  })

export const toApiError = (error: unknown): SingboxApiError => {
  const code = ConnectError.from(error).code

  if (code === Code.Unauthenticated || code === Code.PermissionDenied) return 'unauthorized'
  if (code === Code.Unimplemented || code === Code.NotFound) return 'unimplemented'
  if (code === Code.DeadlineExceeded) return 'timeout'
  return 'network'
}

export const probe = async (endpoint: SingboxEndpoint, timeoutMs = 3000): Promise<ProbeResult> => {
  const client = createServiceClient(endpoint)

  try {
    const version = await client.getVersion({}, { timeoutMs })
    const started = await client.getStartedAt({}, { timeoutMs }).catch(() => undefined)

    return {
      ok: true,
      info: { version: version.version, apiVersion: version.apiVersion },
      startedAt: started ? Number(started.startedAt) : 0,
    }
  } catch (error) {
    return { ok: false, error: toApiError(error) }
  }
}
