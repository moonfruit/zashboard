import {
  create,
  fromBinary,
  toBinary,
  type DescMessage,
  type DescMethodServerStreaming,
  type MessageInitShape,
  type MessageShape,
} from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { websocketUrl, type SingboxEndpoint } from './endpoint'

export type GrpcFrame = {
  trailer: boolean
  body: Uint8Array
}

export type SocketFactory = (url: string, protocols: string[]) => WebSocket

const CLOSING = 2
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const FINISH_SEND = Uint8Array.of(1)

export const encodeHeaders = (headers: Record<string, string>) =>
  encoder.encode(
    Object.entries(headers)
      .map(([key, value]) => `${key}: ${value}\r\n`)
      .join(''),
  )

export const encodeDataFrame = (payload: Uint8Array) => {
  const frame = new Uint8Array(6 + payload.length)

  new DataView(frame.buffer).setUint32(2, payload.length)
  frame.set(payload, 6)
  return frame
}

export class FrameDecoder {
  private buffer = new Uint8Array(0)

  push(chunk: Uint8Array): GrpcFrame[] {
    const merged = new Uint8Array(this.buffer.length + chunk.length)
    const frames: GrpcFrame[] = []
    let offset = 0

    merged.set(this.buffer)
    merged.set(chunk, this.buffer.length)

    while (merged.length - offset >= 5) {
      const length = new DataView(merged.buffer, offset + 1, 4).getUint32(0)

      if (merged.length - offset - 5 < length) break

      frames.push({
        trailer: ((merged[offset] ?? 0) & 0x80) !== 0,
        body: merged.slice(offset + 5, offset + 5 + length),
      })
      offset += 5 + length
    }

    this.buffer = merged.slice(offset)
    return frames
  }
}

export const parseMetadata = (body: Uint8Array) => {
  const metadata: Record<string, string> = {}

  for (const line of decoder.decode(body).split('\r\n')) {
    const index = line.indexOf(':')

    if (index <= 0) continue
    metadata[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim()
  }

  return metadata
}

export const statusError = (metadata: Record<string, string>): ConnectError | undefined => {
  if (!('grpc-status' in metadata)) return undefined

  const code = Number(metadata['grpc-status'])

  if (code === 0) return undefined

  let message = metadata['grpc-message'] ?? ''

  try {
    message = decodeURIComponent(message)
  } catch {}

  return new ConnectError(
    message,
    Number.isInteger(code) && code > 0 && code <= Code.Unauthenticated ? code : Code.Unknown,
  )
}

const defaultSocket: SocketFactory = (url, protocols) => new WebSocket(url, protocols)

export const CONNECT_TIMEOUT_MS = 5000

export type StreamOptions = {
  createSocket?: SocketFactory
  headers?: Record<string, string>
  connectTimeoutMs?: number
}

export async function* wsServerStream<I extends DescMessage, O extends DescMessage>(
  endpoint: SingboxEndpoint,
  method: DescMethodServerStreaming<I, O>,
  request: MessageInitShape<I>,
  signal: AbortSignal,
  {
    createSocket = defaultSocket,
    headers: extraHeaders = {},
    connectTimeoutMs = CONNECT_TIMEOUT_MS,
  }: StreamOptions = {},
): AsyncGenerator<MessageShape<O>> {
  if (signal.aborted) return

  const frames = new FrameDecoder()
  const items: MessageShape<O>[] = []
  let finished = false
  let failure: ConnectError | undefined
  let wake: (() => void) | undefined

  const notify = () => {
    wake?.()
    wake = undefined
  }

  const finish = (error?: ConnectError) => {
    if (finished) return
    finished = true
    failure = error
    notify()
  }

  const socket = createSocket(websocketUrl(endpoint, method.parent.typeName, method.name), [
    'grpc-websockets',
  ])

  const connectTimer = setTimeout(() => {
    finish(new ConnectError('websocket connect timeout', Code.DeadlineExceeded))
    socket.close()
  }, connectTimeoutMs)

  socket.binaryType = 'arraybuffer'
  socket.onopen = () => {
    clearTimeout(connectTimer)

    const headers: Record<string, string> = {
      ...extraHeaders,
      'content-type': 'application/grpc-web+proto',
      'x-grpc-web': '1',
    }

    if (endpoint.secret) headers.authorization = `Bearer ${endpoint.secret}`

    socket.send(encodeHeaders(headers))
    socket.send(encodeDataFrame(toBinary(method.input, create(method.input, request))))
    socket.send(FINISH_SEND)
  }
  socket.onmessage = (event: MessageEvent) => {
    if (finished) return

    try {
      for (const frame of frames.push(new Uint8Array(event.data as ArrayBuffer))) {
        if (!frame.trailer) {
          items.push(fromBinary(method.output, frame.body))
          continue
        }

        const metadata = parseMetadata(frame.body)

        if ('grpc-status' in metadata) {
          finish(statusError(metadata))
          socket.close()
          return
        }
      }
      notify()
    } catch (error) {
      finish(new ConnectError(String(error), Code.Internal))
      socket.close()
    }
  }
  socket.onerror = () => finish(new ConnectError('websocket error', Code.Unavailable))
  socket.onclose = (event: CloseEvent) =>
    finish(new ConnectError(event.reason || 'websocket closed', Code.Unavailable))

  const onAbort = () => {
    finish()
    socket.close()
  }

  signal.addEventListener('abort', onAbort, { once: true })

  try {
    while (true) {
      if (signal.aborted) return

      const item = items.shift()

      if (item) {
        yield item
        continue
      }

      if (finished) {
        if (failure && !signal.aborted) throw failure
        return
      }

      await new Promise<void>((resolve) => (wake = resolve))
    }
  } finally {
    clearTimeout(connectTimer)
    signal.removeEventListener('abort', onAbort)
    if (socket.readyState < CLOSING) socket.close()
  }
}
