import http from 'node:http'
import { parseArgs } from 'node:util'
import { WebSocketServer } from 'ws'

const { values: args } = parseArgs({
  options: {
    port: { type: 'string', default: '19999' },
    upstream: { type: 'string', default: '19998' },
  },
})

const varint = (value) => {
  let n = BigInt(value)
  const out = []
  while (n > 127n) {
    out.push(Number(n & 127n) | 128)
    n >>= 7n
  }
  out.push(Number(n))
  return out
}
const key = (field, wire) => varint((field << 3) | wire)
const bytes = (field, data) => [...key(field, 2), ...varint(data.length), ...data]
const str = (field, value) => (value ? bytes(field, [...Buffer.from(value)]) : [])
const int = (field, value) => (value ? [...key(field, 0), ...varint(value)] : [])
const bool = (field, value) => (value ? [...key(field, 0), 1] : [])
const msg = (field, data) => bytes(field, data)
const dbl = (field, value) => {
  const buffer = Buffer.alloc(8)
  buffer.writeDoubleLE(value)
  return [...key(field, 1), ...buffer]
}

const frame = (flag, body) => {
  const out = Buffer.alloc(5 + body.length)
  out[0] = flag
  out.writeUInt32BE(body.length, 1)
  Buffer.from(body).copy(out, 5)
  return out
}
const dataFrame = (body) => frame(0, body)
const trailerFrame = (status = 0, message = '') =>
  frame(0x80, [...Buffer.from(`grpc-status: ${status}\r\ngrpc-message: ${message}\r\n`)])

const startedAt = Date.now() - 3_723_000
let uplinkTotal = 0
let downlinkTotal = 0

const version = () => [...str(1, '1.15.0-alpha.6-reF1nd-moonfruit.2'), ...int(2, 5)]

const status = () => {
  const up = 20_000 + Math.floor(Math.random() * 5000)
  const down = 200_000 + Math.floor(Math.random() * 50_000)
  uplinkTotal += up
  downlinkTotal += down
  return [
    ...int(1, 48 * 1024 * 1024),
    ...int(2, 123),
    ...int(3, 2),
    ...int(4, 2),
    ...bool(5, true),
    ...int(6, up),
    ...int(7, down),
    ...int(8, uplinkTotal),
    ...int(9, downlinkTotal),
  ]
}

const connection = (id, extra = {}) => [
  ...str(1, id),
  ...str(2, 'tun-in'),
  ...str(3, 'tun'),
  ...int(4, 4),
  ...str(5, extra.network ?? 'tcp'),
  ...str(6, `172.19.0.2:${50000 + id.length}`),
  ...str(7, extra.destination ?? '1.1.1.1:443'),
  ...str(8, extra.domain ?? 'example.com'),
  ...str(9, extra.protocol ?? 'tls'),
  ...str(11, extra.fromOutbound ?? ''),
  ...int(12, startedAt),
  ...int(13, extra.closedAt ?? 0),
  ...str(18, 'rule_set=geosite-cn'),
  ...str(19, 'proxy'),
  ...str(20, 'vless'),
  ...str(21, 'node-a'),
  ...str(21, 'proxy'),
  ...msg(22, str(4, '/usr/bin/curl')),
  ...str(1000, extra.sniffHost ?? 'example.com'),
]

const event = (type, id, body = {}) => [
  ...int(1, type),
  ...str(2, id),
  ...(body.connection ? msg(3, body.connection) : []),
  ...int(4, body.up ?? 0),
  ...int(5, body.down ?? 0),
  ...int(6, body.closedAt ?? 0),
]

const connectionEvents = (events, reset = false) => [
  ...events.flatMap((item) => msg(1, item)),
  ...bool(2, reset),
]

const ESC = '\u001b'
let logSeq = 0
const logLine = (level, text) => {
  const labels = ['PANIC', 'FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE']
  const colors = [31, 31, 31, 33, 36, 37, 90]
  const seconds = String(Math.floor((Date.now() - startedAt) / 1000)).padStart(4, '0')
  logSeq += 1
  return [
    ...int(1, level),
    ...str(
      2,
      `${ESC}[${colors[level]}m${labels[level]}${ESC}[0m[${seconds}] [${ESC}[38;5;208m${3000 + logSeq} 5ms${ESC}[0m] dns: ${text} exchanged example.com from 172.19.0.2:53`,
    ),
  ]
}
const logMessage = (lines, reset = false) => [
  ...lines.flatMap((line) => msg(1, line)),
  ...bool(2, reset),
]

const logHistory = [logLine(4, 'hello'), logLine(5, 'debug'), logLine(3, 'warn')]
const logSubscribers = new Set()
const mock = { unauthenticated: false }
const statusSenders = new Set()
const sockets = new Set()

setInterval(() => {
  const line = logLine(4, 'tick')

  logHistory.push(line)
  if (logHistory.length > 200) logHistory.shift()
  logSubscribers.forEach((send) => send(logMessage([line])))
}, 2000)

const groups = (selected) =>
  msg(1, [
    ...str(1, 'proxy'),
    ...str(2, 'selector'),
    ...bool(3, true),
    ...str(4, selected),
    ...msg(6, [...str(1, 'node-a'), ...str(2, 'vless'), ...int(3, 1), ...int(4, 120)]),
    ...msg(6, [...str(1, 'node-b'), ...str(2, 'vless'), ...int(3, 1), ...int(4, 180)]),
  ])

const peer = (host, ip, extra = {}) => [
  ...str(1, host),
  ...str(2, `${host}.example.ts.net.`),
  ...str(3, 'linux'),
  ...str(4, ip),
  ...bool(5, extra.online ?? true),
  ...bool(6, extra.exitNode ?? false),
  ...bool(7, extra.exitNodeOption ?? false),
  ...int(9, 1024 * 1024),
  ...int(10, 512 * 1024),
  ...int(11, Math.floor(Date.now() / 1000) + 86400 * 90),
  ...str(12, `stable-${host}`),
]

const tailscale = () =>
  msg(1, [
    ...str(1, 'ts-ep'),
    ...str(2, 'Running'),
    ...str(3, 'Connected'),
    ...str(5, 'example.ts.net'),
    ...str(6, 'example.ts.net'),
    ...msg(7, peer('this-box', '100.64.0.1')),
    ...msg(8, [
      ...int(1, 1),
      ...str(2, 'alice@example.com'),
      ...str(3, 'Alice'),
      ...msg(5, peer('gateway', '100.64.0.2', { exitNodeOption: true })),
      ...msg(5, peer('laptop', '100.64.0.3', { online: false })),
    ]),
  ])

const openvpn = () =>
  msg(1, [
    ...str(1, 'ovpn'),
    ...str(2, 'auth-pending'),
    ...str(3, 'Waiting for credentials'),
    ...msg(4, [
      ...str(1, 'ch-1'),
      ...str(2, 'credentials'),
      ...str(3, 'alice'),
      ...str(4, 'Sign in to corp VPN'),
    ]),
    ...msg(6, [
      ...str(
        1,
        'vpn.example.com:1194 with-a-very-long-hostname-segment-that-should-wrap.example.com',
      ),
      ...str(4, '10.8.0.2'),
      ...str(6, '10.8.0.1'),
      ...int(7, 1500),
      ...str(9, 'AES-256-GCM'),
    ]),
  ])

const networkQualityStep = (step) => {
  const final = step >= 7
  const phase = final ? 3 : step < 4 ? 1 : 2
  return [
    ...int(1, phase),
    ...int(2, Math.min(step, 4) * 25_000_000),
    ...int(3, Math.max(step - 3, 0) * 8_000_000),
    ...int(4, Math.min(step, 4) * 300),
    ...int(5, Math.max(step - 3, 0) * 200),
    ...int(6, 18),
    ...int(7, step * 1500),
    ...bool(8, final),
    ...int(10, final ? 2 : 0),
    ...int(11, final ? 1 : 0),
    ...int(12, final ? 2 : 0),
    ...int(13, 0),
  ]
}

const stunStep = (step) => [
  ...int(1, step),
  ...str(2, '203.0.113.7:54321'),
  ...int(3, 35),
  ...int(4, step >= 2 ? 1 : 0),
  ...int(5, step >= 2 ? 3 : 0),
  ...bool(6, step >= 2),
  ...bool(8, true),
]

const finite = (build, count, interval) => (send, end) => {
  let step = 0
  const timer = setInterval(() => {
    step += 1
    send(build(step))
    if (step >= count) {
      clearInterval(timer)
      end()
    }
  }, interval)
  return timer
}

const unary = {
  GetVersion: version,
  GetStartedAt: () => int(1, startedAt),
  CloseConnection: () => [],
  CloseAllConnections: () => [],
  SetTailscaleExitNode: () => [],
  TailscaleLogout: () => [],
  ClearLogs: () => {
    const line = logLine(4, 'after clear')

    logHistory.splice(0, logHistory.length, line)
    logSubscribers.forEach((send) => send(logMessage([line], true)))
    return []
  },
  GetEBPFDiagnostics: () => [
    ...msg(1, [
      ...int(1, 1),
      ...int(2, Math.floor(Date.now() / 1000)),
      ...str(3, 'ebpf-in'),
      ...str(4, 'normal'),
      ...bool(5, true),
      ...str(6, 'tc'),
      ...bool(7, true),
      ...str(8, 'cgroup'),
      ...int(23, 42),
    ]),
    ...msg(1, [
      ...int(1, 1),
      ...str(3, 'ebpf-lan'),
      ...str(4, 'needs_attention'),
      ...bool(5, true),
      ...str(6, 'xdp'),
      ...str(11, 'attach eth1: operation not permitted'),
      ...bool(15, true),
    ]),
    ...msg(2, [...int(1, Math.floor(Date.now() / 1000)), ...str(3, 'bpffs not mounted')]),
  ],
}

const streams = {
  SubscribeStatus: (send) => {
    const sender = { stalled: false }

    statusSenders.add(sender)
    send(status())
    const timer = setInterval(() => {
      if (!statusSenders.has(sender)) return clearInterval(timer)
      if (!sender.stalled) send(status())
    }, 1000)
    return { close: () => (clearInterval(timer), statusSenders.delete(sender)) }
  },
  SubscribeConnections: (send) => {
    send(
      connectionEvents(
        [
          event(0, 'c1', { connection: connection('c1') }),
          event(0, 'c2', { connection: connection('c2', { network: 'udp', protocol: 'quic' }) }),
          event(0, 'old', { connection: connection('old', { closedAt: startedAt + 1000 }) }),
        ],
        true,
      ),
    )
    let tick = 0
    return setInterval(() => {
      tick += 1
      const updates = [event(1, 'c1', { up: 1000, down: 50_000 + tick * 1000 })]
      if (tick % 5 === 0) {
        updates.push(event(0, `n${tick}`, { connection: connection(`n${tick}`) }))
      }
      if (tick % 5 === 3) updates.push(event(2, `n${tick - 3}`, { closedAt: Date.now() }))
      send(connectionEvents(updates))
    }, 1000)
  },
  SubscribeLog: (send) => {
    send(logMessage(logHistory, true))
    logSubscribers.add(send)
    return { close: () => logSubscribers.delete(send) }
  },
  SubscribeGroups: (send) => {
    send(groups('node-a'))
    let flip = false
    return setInterval(() => {
      flip = !flip
      send(groups(flip ? 'node-b' : 'node-a'))
    }, 15000)
  },
  SubscribeClashMode: (send) => {
    send(str(3, 'Rule'))
    return undefined
  },
  SubscribeTailscaleStatus: (send) => {
    send(tailscale())
    return undefined
  },
  StartTailscalePing: (send) =>
    setInterval(
      () =>
        send([
          ...dbl(1, 20 + Math.random() * 10),
          ...bool(2, true),
          ...str(3, '203.0.113.5:41641'),
        ]),
      1000,
    ),
  StartNetworkQualityTest: finite(networkQualityStep, 7, 1500),
  StartSTUNTest: finite(stunStep, 2, 4000),
  SubscribeOpenVPNStatus: (send) => {
    send(openvpn())
    return undefined
  },
  SubscribeOpenConnectStatus: (send) => {
    send([])
    return undefined
  },
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers':
    'Content-Type, Authorization, X-Grpc-Web, X-User-Agent, Grpc-Timeout, Accept-Language',
  'access-control-expose-headers': 'Grpc-Status, Grpc-Message, Grpc-Status-Details-Bin',
}

const methodOf = (url) => /^\/daemon\.StartedService\/([^/?]+)/.exec(url ?? '')?.[1]

const proxy = (req, res) => {
  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: args.upstream,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers)
      response.pipe(res)
    },
  )
  upstream.on('error', () => {
    res.writeHead(502)
    res.end()
  })
  req.pipe(upstream)
}

const control = (req, res) => {
  const action = /^\/__mock\/(\w+)/.exec(req.url ?? '')?.[1]

  if (action === 'stall') statusSenders.forEach((sender) => (sender.stalled = true))
  else if (action === 'unauthenticated') {
    mock.unauthenticated = !mock.unauthenticated
    if (mock.unauthenticated) sockets.forEach((ws) => ws.close())
  } else {
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ...mock, statusStreams: statusSenders.size }))
}

const server = http.createServer((req, res) => {
  const method = methodOf(req.url)

  if (req.url?.startsWith('/__mock/')) {
    control(req, res)
    return
  }

  if (!method) {
    proxy(req, res)
    return
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    res.end()
    return
  }

  req.resume()
  req.on('end', () => {
    res.writeHead(200, { ...cors, 'content-type': 'application/grpc-web+proto' })
    const handler = unary[method]
    if (mock.unauthenticated) {
      res.end(trailerFrame(16, 'mock: unauthenticated'))
      return
    }
    res.end(
      handler
        ? Buffer.concat([dataFrame(handler()), trailerFrame()])
        : trailerFrame(12, `${method} not mocked`),
    )
  })
})

const wss = new WebSocketServer({ noServer: true, handleProtocols: () => 'grpc-websockets' })

server.on('upgrade', (req, socket, head) => {
  const method = methodOf(req.url)

  if (!method) {
    socket.destroy()
    return
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    let timer
    let started = false

    sockets.add(ws)

    ws.on('message', (data) => {
      const chunk = Buffer.from(data)
      if (started || chunk[0] !== 0) return
      started = true
      console.log(new Date().toISOString().slice(11, 23), 'stream', method)

      const handler = streams[method]
      if (mock.unauthenticated) {
        ws.send(trailerFrame(16, 'mock: unauthenticated'))
        ws.close()
        return
      }
      if (!handler) {
        ws.send(trailerFrame(12, `${method} not mocked`))
        ws.close()
        return
      }

      ws.send(frame(0x80, [...Buffer.from('content-type: application/grpc-web+proto\r\n')]))
      timer = handler(
        (body) => {
          if (ws.readyState === ws.OPEN) ws.send(dataFrame(body))
        },
        () => {
          if (ws.readyState !== ws.OPEN) return
          ws.send(trailerFrame())
          ws.close()
        },
      )
    })
    ws.on('close', () => {
      sockets.delete(ws)
      if (timer && typeof timer.close === 'function') timer.close()
      else clearInterval(timer)
    })
  })
})

server.listen(Number(args.port), () => {
  console.log(`mock sing-box API on :${args.port}, proxying Clash API to :${args.upstream}`)
})
