import { endpointOf, websocketUrl } from '@/assembly/singbox/api/endpoint'
import {
  ClashModeSchema,
  StartedService,
} from '@/assembly/singbox/api/gen/daemon/started_service_pb'
import {
  encodeDataFrame,
  encodeHeaders,
  FINISH_SEND,
  FrameDecoder,
  parseMetadata,
  statusError,
  wsServerStream,
  type SocketFactory,
} from '@/assembly/singbox/api/websocket'
import { create, toBinary } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { afterEach, describe, expect, it, vi } from 'vitest'

const encoder = new TextEncoder()

const serverFrame = (flag: number, body: Uint8Array) => {
  const frame = new Uint8Array(5 + body.length)
  frame[0] = flag
  new DataView(frame.buffer).setUint32(1, body.length)
  frame.set(body, 5)
  return frame
}

const modeFrame = (mode: string) =>
  serverFrame(0, toBinary(ClashModeSchema, create(ClashModeSchema, { mode })))

const trailer = (text: string) => serverFrame(0x80, encoder.encode(text))

class FakeSocket {
  binaryType = ''
  readyState = 0
  sent: Uint8Array[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { reason: string }) => void) | null = null

  constructor(
    public url: string,
    public protocols: string[],
  ) {}

  send(data: Uint8Array) {
    this.sent.push(data)
  }

  close() {
    this.closed = true
    this.readyState = 3
  }

  open() {
    this.readyState = 1
    this.onopen?.()
  }

  receive(bytes: Uint8Array) {
    this.onmessage?.({ data: bytes.slice().buffer })
  }
}

const setup = () => {
  const sockets: FakeSocket[] = []
  const factory: SocketFactory = (url, protocols) => {
    const socket = new FakeSocket(url, protocols)
    sockets.push(socket)
    return socket as unknown as WebSocket
  }
  return { sockets, factory }
}

const endpoint = { baseUrl: 'http://127.0.0.1:9090', secret: 's3cret' }

describe('endpoint', () => {
  it('builds base url without secondary path', () => {
    expect(endpointOf({ protocol: 'https', host: 'box.lan', port: '9090', password: 'p' })).toEqual(
      { baseUrl: 'https://box.lan:9090', secret: 'p' },
    )
  })

  it('builds websocket url', () => {
    expect(websocketUrl(endpoint, 'daemon.StartedService', 'SubscribeLog')).toBe(
      'ws://127.0.0.1:9090/daemon.StartedService/SubscribeLog',
    )
    expect(websocketUrl({ baseUrl: 'https://a:1', secret: '' }, 'daemon.StartedService', 'X')).toBe(
      'wss://a:1/daemon.StartedService/X',
    )
  })
})

describe('codec', () => {
  it('encodes headers as CRLF lines', () => {
    expect(new TextDecoder().decode(encodeHeaders({ a: '1', b: '2' }))).toBe('a: 1\r\nb: 2\r\n')
  })

  it('prefixes data frames with the websocket marker and grpc header', () => {
    expect([...encodeDataFrame(Uint8Array.of(7, 8))]).toEqual([0, 0, 0, 0, 0, 2, 7, 8])
    expect([...FINISH_SEND]).toEqual([1])
  })

  it('decodes frames split across chunks and several frames in one chunk', () => {
    const decoder = new FrameDecoder()
    const bytes = new Uint8Array([...modeFrame('Rule'), ...trailer('grpc-status: 0\r\n')])

    expect(decoder.push(bytes.slice(0, 3))).toEqual([])
    const frames = decoder.push(bytes.slice(3))

    expect(frames.map((frame) => frame.trailer)).toEqual([false, true])
  })

  it('parses metadata and maps status', () => {
    const metadata = parseMetadata(
      encoder.encode('Grpc-Status: 16\r\ngrpc-message: bad%20secret\r\n'),
    )

    expect(metadata['grpc-status']).toBe('16')
    const error = statusError(metadata)
    expect(error?.code).toBe(Code.Unauthenticated)
    expect(error?.rawMessage).toBe('bad secret')
    expect(statusError({ 'grpc-status': '0' })).toBeUndefined()
    expect(statusError({})).toBeUndefined()
    expect(statusError({ 'grpc-message': 'x' })).toBeUndefined()
  })
})

describe('wsServerStream', () => {
  const method = StartedService.method.subscribeClashMode

  it('sends headers, request and half-close, then yields messages until status 0', async () => {
    const { sockets, factory } = setup()
    const iterator = wsServerStream(endpoint, method, {}, new AbortController().signal, {
      createSocket: factory,
    })
    const first = iterator.next()
    const socket = sockets[0]

    expect(socket.url).toBe('ws://127.0.0.1:9090/daemon.StartedService/SubscribeClashMode')
    expect(socket.protocols).toEqual(['grpc-websockets'])

    socket.open()
    const headers = new TextDecoder().decode(socket.sent[0])
    expect(headers).toContain('content-type: application/grpc-web+proto\r\n')
    expect(headers).toContain('x-grpc-web: 1\r\n')
    expect(headers).toContain('authorization: Bearer s3cret\r\n')
    expect(socket.sent[1][0]).toBe(0)
    expect([...socket.sent[2]]).toEqual([1])

    socket.receive(serverFrame(0x80, encoder.encode('content-type: application/grpc-web\r\n')))
    socket.receive(modeFrame('Rule'))
    expect((await first).value?.mode).toBe('Rule')

    socket.receive(new Uint8Array([...modeFrame('Global'), ...trailer('grpc-status: 0\r\n')]))
    expect((await iterator.next()).value?.mode).toBe('Global')
    expect((await iterator.next()).done).toBe(true)
    expect(socket.closed).toBe(true)
  })

  it('throws ConnectError with the trailer status', async () => {
    const { sockets, factory } = setup()
    const iterator = wsServerStream(endpoint, method, {}, new AbortController().signal, {
      createSocket: factory,
    })
    const first = iterator.next()

    sockets[0].open()
    sockets[0].receive(trailer('grpc-status: 12\r\ngrpc-message: nope\r\n'))

    await expect(first).rejects.toMatchObject({ code: Code.Unimplemented })
  })

  it('treats an unexpected close as unavailable', async () => {
    const { sockets, factory } = setup()
    const iterator = wsServerStream(endpoint, method, {}, new AbortController().signal, {
      createSocket: factory,
    })
    const first = iterator.next()

    sockets[0].open()
    sockets[0].onclose?.({ reason: '' })

    const error = await first.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ConnectError)
    expect((error as ConnectError).code).toBe(Code.Unavailable)
  })

  it('ends quietly on abort', async () => {
    const { sockets, factory } = setup()
    const controller = new AbortController()
    const iterator = wsServerStream(endpoint, method, {}, controller.signal, {
      createSocket: factory,
    })
    const first = iterator.next()

    sockets[0].open()
    controller.abort()

    expect((await first).done).toBe(true)
    expect(sockets[0].closed).toBe(true)
  })

  it('omits authorization without secret', async () => {
    const { sockets, factory } = setup()
    const iterator = wsServerStream(
      { baseUrl: endpoint.baseUrl, secret: '' },
      method,
      {},
      new AbortController().signal,
      { createSocket: factory },
    )
    void iterator.next()
    sockets[0].open()

    expect(new TextDecoder().decode(sockets[0].sent[0])).not.toContain('authorization')
  })

  it('sends extra headers in the first frame', async () => {
    const { sockets, factory } = setup()
    const iterator = wsServerStream(endpoint, method, {}, new AbortController().signal, {
      createSocket: factory,
      headers: { 'accept-language': 'zh' },
    })
    void iterator.next()
    sockets[0].open()

    expect(new TextDecoder().decode(sockets[0].sent[0])).toContain('accept-language: zh\r\n')
  })

  it('does not yield buffered items after abort', async () => {
    const { sockets, factory } = setup()
    const controller = new AbortController()
    const iterator = wsServerStream(endpoint, method, {}, controller.signal, {
      createSocket: factory,
    })
    const first = iterator.next()

    sockets[0].open()
    sockets[0].receive(new Uint8Array([...modeFrame('Rule'), ...modeFrame('Global')]))
    expect((await first).value?.mode).toBe('Rule')
    controller.abort()

    expect((await iterator.next()).done).toBe(true)
  })

  describe('connect timeout', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('closes the socket and throws DeadlineExceeded when it does not open in time', async () => {
      vi.useFakeTimers()
      const { sockets, factory } = setup()
      const iterator = wsServerStream(endpoint, method, {}, new AbortController().signal, {
        createSocket: factory,
      })
      const first = iterator.next().catch((e: unknown) => e)

      await vi.advanceTimersByTimeAsync(4999)
      expect(sockets[0].closed).toBe(false)
      await vi.advanceTimersByTimeAsync(1)

      const error = await first
      expect(error).toBeInstanceOf(ConnectError)
      expect((error as ConnectError).code).toBe(Code.DeadlineExceeded)
      expect(sockets[0].closed).toBe(true)
    })

    it('is cancelled once the socket opens', async () => {
      vi.useFakeTimers()
      const { sockets, factory } = setup()
      const iterator = wsServerStream(endpoint, method, {}, new AbortController().signal, {
        createSocket: factory,
        connectTimeoutMs: 100,
      })
      const first = iterator.next()

      sockets[0].open()
      await vi.advanceTimersByTimeAsync(1000)
      expect(sockets[0].closed).toBe(false)
      sockets[0].receive(modeFrame('Rule'))
      expect((await first).value?.mode).toBe('Rule')
    })
  })
})
