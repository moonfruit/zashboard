# sing-box API 接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 clash 后端 + sing-box 内核 + moonfruit 变体、且同端口 API service 可用时，把流量/内存、连接、日志、变化通知改走 sing-box API（gRPC-Web / grpc-websockets），并新增「工具」页（网络质量、STUN、eBPF、Tailscale、OpenVPN、OpenConnect）。

**Architecture:** 探测成功后 `driver()` 返回 `singboxApiDriver`（`singboxDriver` 的展开，只覆盖 metrics / connections / logs / events），其余仍走 Clash。gRPC 客户端、常驻流和工具页全部通过动态 `import()` 懒加载；主 chunk 里只有纯映射模块和状态 ref（只用 `import type` 引用生成代码）。常驻 server streaming 走 grpc-websockets，一元调用走 connect-web 的 fetch。

**Tech Stack:** Vue 3 + TypeScript + Vite，`@connectrpc/connect` / `@connectrpc/connect-web` 2.x，`@bufbuild/protobuf` 2.x（protoc-gen-es `target=ts`），`uqr`，vitest + happy-dom（`fork-test/`）。

**Spec:** `docs/superpowers/specs/2026-09-25-singbox-api-design.md`

## Global Constraints

- 新逻辑放新文件；上游文件只加最少的挂接点；不格式化、不重构上游代码；不写注释（上游已删除全部注释）。
- 不改 `CHANGELOG.md`、`package.json` 的 `version`；不 `git push --tags`。
- 包管理器是 `pnpm@11`；`pnpm-lock.yaml` 冲突时取上游版本后重新 `pnpm i`。
- 视图层（`src/components/**`、`src/views/**`、`src/composables/**`）只通过 `can()` 和 assembly 门面访问数据，不得导入 `@/api`、`@/api/clash`、`core`、`resetCore`，也不导入 `src/assembly/singbox/api/client.ts` / `runtime.ts` / 生成代码。
- 主 chunk 不得静态引入 `@connectrpc/*` 或生成代码的运行时值：主 chunk 模块对 `gen/` 只能 `import type`；枚举值用本地常量镜像。
- int64 字段是 `bigint`，进入应用状态前一律 `Number(...)`；`interval` 单位是纳秒（1 秒 = `1_000_000_000n`）。
- 只在使用 sing-box API 时（`can('singboxApi')`）隐藏 SniffHost；ref1nd、探测失败的 moonfruit 保持现状。
- 新增文案放 `src/i18n/singbox/{en,zh,zh-tw,ru}.ts`，四份同时加；`zh` / `zh-tw` / `ru` 的类型是 `typeof singboxEn`。
- 每个任务结束时都要通过：`pnpm type-check`、`pnpm exec eslint .`、`pnpm -C fork-test type-check`、`pnpm -C fork-test test`；涉及 UI 或依赖的任务再加 `pnpm build`。
- 提交会触发 husky pre-commit（type-check + lint-staged 的 eslint --fix / prettier --write），提交后用 `git show --stat HEAD` 确认被改写的内容。

## Review Focus

- 探测进行中切换了后端：旧后端的探测结果晚到时，不得把 `singboxApi` 设到新后端上（Task 5 的 `probe.test.ts` 覆盖）。
- moonfruit 执行 `PUT /configs` 重载后所有流断开重连：连接累加器要按 reset 重建且已关闭列表不重复（Task 7），日志不重复投递积压（Task 9）。
- API service 的 secret 与 Clash secret 不一致：必须静默退回 Clash，只在状态行显示“未授权”（Task 5 覆盖）。
- 带 ANSI 颜色的日志经过源 IP 标签替换和搜索高亮后，颜色段仍与文字对齐，不能出现错位或丢字（Task 8 覆盖）。
- 连接的 NEW / CLOSED 事件在两次 UPDATE 之间单独到达时，不能让所有连接的速率闪成 0：driver 只按 1 秒节拍产出 payload（Task 7 覆盖）。

---

## 文件结构

新增（fork 自有）：

| 路径 | 职责 |
|---|---|
| `fork-proto/`（`package.json`、`pnpm-workspace.yaml`、`buf.gen.yaml`、`proto/daemon/started_service.proto`、`proto/SOURCE`） | 独立 pnpm 项目，vendor proto 并生成代码 |
| `src/assembly/singbox/api/gen/daemon/started_service_pb.ts` | 生成产物（提交） |
| `src/assembly/singbox/api/endpoint.ts` | 由 Backend 算出 baseUrl 与 secret（纯函数，主 chunk） |
| `src/assembly/singbox/api/state.ts` | `singboxApi`、`singboxApiError`、`singboxStreamError`、`singboxRuntime`、`singboxApiModule` 等 ref（主 chunk） |
| `src/assembly/singbox/api/probe.ts` | `probeSingboxApi(backend)`：动态加载 runtime 并探测（主 chunk） |
| `src/assembly/singbox/api/websocket.ts` | grpc-websockets 编解码与 `wsServerStream`（懒加载） |
| `src/assembly/singbox/api/stream.ts` | `createSharedStream`：引用计数、退避重连、终止码（懒加载） |
| `src/assembly/singbox/api/client.ts` | connect-web 一元客户端、`probe`、`serverStream`（懒加载） |
| `src/assembly/singbox/api/streams.ts` | 常驻流实例：status / connections / log / groups / clashMode（懒加载） |
| `src/assembly/singbox/api/runtime.ts` | 懒加载入口，汇总 client 与 streams 的导出 |
| `src/assembly/singbox/api-status.ts` | 状态行门面 `singboxApiStatus` |
| `src/assembly/singbox/status.ts` | Status → traffic / memory / runtime 映射 |
| `src/assembly/singbox/connection-events.ts` | 连接事件累加器与 accessor |
| `src/assembly/singbox/connection-keys.ts` | 连接列可用性 `isConnectionKeyAvailable` |
| `src/assembly/singbox/ansi.ts` | ANSI SGR 解析、按文本映射、按区间高亮 |
| `src/assembly/singbox/api-logs.ts` | 日志级别映射、去前缀、级别过滤、积压去重 |
| `src/assembly/singbox/events.ts` | Groups / ClashMode 变化检测（纯函数，被 driver 引用） |
| `src/assembly/singbox/refresh.ts` | 事件到 `fetchProxies` / `fetchConfigs` 的防抖分发（只被 session 引用） |
| `src/assembly/singbox/tools/*.ts` | 工具页各区块门面（懒加载） |
| `src/assembly/driver/singbox-api.ts` | `singboxApiDriver` |
| `src/types/singbox.d.ts` | `SingboxConnectionRawMessage` |
| `src/i18n/singbox/{en,zh,zh-tw,ru}.ts` | fork 文案 |
| `src/components/singbox/*.vue`、`src/components/singbox/tools/*.vue`、`src/views/ToolsPage.vue` | 视图 |
| `fork-test/singbox/api/*.test.ts` | 单元测试 |
| `fork-test/mock-singbox-api.mjs` | 冒烟用 mock |

上游挂接点（每处只加几行）：`package.json`（依赖）、`eslint.config.js`、`.prettierignore`（新建）、`.github/workflows/fork-ci.yml`、`src/assembly/backend.ts`、`src/assembly/version.ts`、`src/assembly/driver/index.ts`、`src/assembly/driver/types.ts`、`src/assembly/session.ts`、`src/assembly/logs.ts`、`src/assembly/connections.ts`、`src/types/index.d.ts`、`src/constant/index.ts`、`src/store/settings.ts`、`src/store/connections.ts`、`src/router/index.ts`、`src/helper/index.ts`、`src/i18n/{en,zh,zh-tw,ru}.ts`、`src/views/OverviewPage.vue`、`src/components/overview/OverviewCardSettingsDialog.vue`、`src/components/settings/backend/BackendSettings.vue`、`src/components/logs/{LogsCard,LogsTable}.vue`、`src/components/connections/{ConnectionTable.vue,ConnectionCard.tsx,ConnectionDetails.vue}`、`src/components/controls/ConnectionCtrl.tsx`、`src/components/settings/connections/{TableSettings,ConnectionCardSettings}.vue`、`FORK.md`、`CLAUDE.md`。

---

### Task 1: proto vendor、代码生成与依赖

**Files:**
- Create: `fork-proto/package.json`, `fork-proto/pnpm-workspace.yaml`, `fork-proto/buf.gen.yaml`, `fork-proto/proto/daemon/started_service.proto`, `fork-proto/proto/SOURCE`, `fork-proto/.gitignore`, `.prettierignore`
- Create (generated): `src/assembly/singbox/api/gen/daemon/started_service_pb.ts`
- Modify: `package.json`, `pnpm-lock.yaml`, `eslint.config.js:12-15`, `.github/workflows/fork-ci.yml`, `FORK.md`, `CLAUDE.md`

**Interfaces:**
- Produces: 生成模块 `@/assembly/singbox/api/gen/daemon/started_service_pb`，导出 `StartedService`（`StartedService.method.<camelName>`，例如 `subscribeStatus`、`getVersion`、`uRLTest`、`startSTUNTest`、`getEBPFDiagnostics`）、各消息类型（`Status`、`ConnectionEvents`、`Connection`、`Log`、`Log_Message`、`Groups`、`ClashMode`、`TailscaleStatusUpdate`、`OpenVPNStatusUpdate` 等）及其 `XxxSchema`，枚举 `LogLevel`（`PANIC=0 … TRACE=6`）、`ConnectionEventType`（`CONNECTION_EVENT_NEW=0`、`CONNECTION_EVENT_UPDATE=1`、`CONNECTION_EVENT_CLOSED=2`）。

- [ ] **Step 1: 建 fork-proto 项目**

`fork-proto/package.json`（`packageManager` 复制 `fork-test/package.json` 的同一行）：

```json
{
  "name": "zashboard-fork-proto",
  "private": true,
  "type": "module",
  "scripts": {
    "sync": "cp \"${SINGBOX_SRC:-../../../go/mod/sing-box}/daemon/started_service.proto\" proto/daemon/ && git -C \"${SINGBOX_SRC:-../../../go/mod/sing-box}\" rev-parse HEAD > proto/SOURCE",
    "generate": "buf generate"
  },
  "devDependencies": {
    "@bufbuild/buf": "^1.72.0",
    "@bufbuild/protoc-gen-es": "^2.13.0"
  },
  "packageManager": "pnpm@11.20.0+sha512.9a6f330a95b66446ea088faf1521405a8a01f07fde7124cc9958dfed52d4bb436737e65b08f85f37b46fcba375092558ac51262b816844b22f63406ed166bfee"
}
```

`fork-proto/pnpm-workspace.yaml`：

```yaml
minimumReleaseAge: 10080

allowBuilds:
  '@bufbuild/buf': true
```

`fork-proto/buf.gen.yaml`：

```yaml
version: v2
clean: true
inputs:
  - directory: proto
plugins:
  - local: protoc-gen-es
    out: ../src/assembly/singbox/api/gen
    opt: target=ts
```

`fork-proto/.gitignore`：

```
node_modules
```

- [ ] **Step 2: 同步 proto 并安装**

```bash
mkdir -p fork-proto/proto/daemon
( cd /Users/moon/Workspace.localized/go/mod/sing-box && git switch --quiet moonfruit )
pnpm -C fork-proto i
pnpm -C fork-proto sync
cat fork-proto/proto/SOURCE
```

Expected：`proto/daemon/started_service.proto` 存在（约 930 行，含 `GetEBPFDiagnostics`），`SOURCE` 是一行 commit hash。

- [ ] **Step 3: 加运行时依赖**

```bash
pnpm add @connectrpc/connect@^2.1.2 @connectrpc/connect-web@^2.1.2 @bufbuild/protobuf@^2.13.0 uqr@^0.1.3
pnpm -C fork-proto ls @bufbuild/protoc-gen-es
pnpm ls @bufbuild/protobuf
```

Expected：`@bufbuild/protobuf` 的版本 ≥ `protoc-gen-es` 的版本（生成代码要求运行时不低于生成器版本）。若运行时更低，把 `fork-proto/package.json` 的 `@bufbuild/protoc-gen-es` 固定到与根目录 `@bufbuild/protobuf` 相同的版本后重新 `pnpm -C fork-proto i`。

- [ ] **Step 4: 生成代码**

```bash
pnpm -C fork-proto generate
ls src/assembly/singbox/api/gen/daemon/
rg -n "^export (enum|const) (StartedService|LogLevel|ConnectionEventType)\b" src/assembly/singbox/api/gen/daemon/started_service_pb.ts
```

Expected：`started_service_pb.ts` 存在，三个导出都能找到。

- [ ] **Step 5: 让 lint 与 prettier 跳过生成目录**

`eslint.config.js` 的 `app/files-to-ignore`：

```js
  {
    name: 'app/files-to-ignore',
    ignores: ['**/dist/**', '**/dist-ssr/**', '**/coverage/**', 'src/assembly/singbox/api/gen/**'],
  },
```

新建 `.prettierignore`：

```
src/assembly/singbox/api/gen/
```

- [ ] **Step 6: CI 检查生成产物一致**

`.github/workflows/fork-ci.yml` 在 `Build` 之后加：

```yaml
      - name: Install fork proto
        run: pnpm -C fork-proto i

      - name: Check generated code
        run: pnpm -C fork-proto generate && git diff --exit-code -- src/assembly/singbox/api/gen
```

- [ ] **Step 7: 文档**

`FORK.md` 的「测试」一节之前加一节：

```markdown
## sing-box API 代码生成

`fork-proto/` 是独立的 pnpm 项目，vendor 了 sing-box moonfruit 分支的 `daemon/started_service.proto`，用 buf + protoc-gen-es 生成 `src/assembly/singbox/api/gen/`。生成产物提交进仓库，构建不依赖 buf。

```bash
pnpm -C fork-proto i
pnpm -C fork-proto sync       # 从 SINGBOX_SRC（默认 ../../../go/mod/sing-box）拷贝 proto，并记录 commit 到 proto/SOURCE
pnpm -C fork-proto generate
```

`fork-ci.yml` 会重新生成并检查没有差异。
```

`CLAUDE.md` 的「命令」一节，在 `### fork 测试` 之前加：

```markdown
### sing-box API 代码生成（`fork-proto/`）

`pnpm -C fork-proto i && pnpm -C fork-proto sync && pnpm -C fork-proto generate`，产物在 `src/assembly/singbox/api/gen/`（提交，eslint / prettier 忽略）。主 chunk 只能 `import type` 生成代码，运行时值只在懒加载的 `runtime.ts` 链路里用。
```

- [ ] **Step 8: 验证**

```bash
pnpm type-check
pnpm exec eslint .
pnpm build
pnpm -C fork-test type-check
pnpm -C fork-test test
```

Expected：全部通过；生成代码还没被引用，`dist/assets/index-*.js` 体积与改动前相比没有变化（生成代码被 tree-shake 掉）。

- [ ] **Step 9: Commit**

```bash
git add fork-proto .prettierignore eslint.config.js package.json pnpm-lock.yaml .github/workflows/fork-ci.yml FORK.md CLAUDE.md src/assembly/singbox/api/gen
git commit -m "build(singbox): vendor sing-box API proto and generate client code"
```

---

### Task 2: grpc-websockets 传输

**Files:**
- Create: `src/assembly/singbox/api/endpoint.ts`, `src/assembly/singbox/api/websocket.ts`
- Test: `fork-test/singbox/api/websocket.test.ts`

**Interfaces:**
- Consumes: Task 1 的生成代码（测试里用 `StartedService.method.subscribeClashMode`、`ClashModeSchema`）。
- Produces:
  - `type SingboxEndpoint = { baseUrl: string; secret: string }`
  - `endpointOf(backend: Pick<Backend, 'protocol' | 'host' | 'port' | 'password'>): SingboxEndpoint`
  - `websocketUrl(endpoint, service: string, method: string): string`
  - `encodeHeaders(headers: Record<string, string>): Uint8Array`、`encodeDataFrame(payload: Uint8Array): Uint8Array`、`FINISH_SEND: Uint8Array`
  - `class FrameDecoder { push(chunk: Uint8Array): GrpcFrame[] }`，`type GrpcFrame = { trailer: boolean; body: Uint8Array }`
  - `parseMetadata(body: Uint8Array): Record<string, string>`、`statusError(metadata): ConnectError | undefined`
  - `type SocketFactory = (url: string, protocols: string[]) => WebSocket`
  - `wsServerStream<I, O>(endpoint, method: DescMethodServerStreaming<I, O>, request: MessageInitShape<I>, signal: AbortSignal, createSocket?: SocketFactory): AsyncGenerator<MessageShape<O>>`

- [ ] **Step 1: 写失败的测试**

`fork-test/singbox/api/websocket.test.ts`：

```ts
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
import { describe, expect, it } from 'vitest'

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
    expect(
      endpointOf({ protocol: 'https', host: 'box.lan', port: '9090', password: 'p' }),
    ).toEqual({ baseUrl: 'https://box.lan:9090', secret: 'p' })
  })

  it('builds websocket url', () => {
    expect(websocketUrl(endpoint, 'daemon.StartedService', 'SubscribeLog')).toBe(
      'ws://127.0.0.1:9090/daemon.StartedService/SubscribeLog',
    )
    expect(
      websocketUrl({ baseUrl: 'https://a:1', secret: '' }, 'daemon.StartedService', 'X'),
    ).toBe('wss://a:1/daemon.StartedService/X')
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
  })
})

describe('wsServerStream', () => {
  const method = StartedService.method.subscribeClashMode

  it('sends headers, request and half-close, then yields messages until status 0', async () => {
    const { sockets, factory } = setup()
    const iterator = wsServerStream(endpoint, method, {}, new AbortController().signal, factory)
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
    const iterator = wsServerStream(endpoint, method, {}, new AbortController().signal, factory)
    const first = iterator.next()

    sockets[0].open()
    sockets[0].receive(trailer('grpc-status: 12\r\ngrpc-message: nope\r\n'))

    await expect(first).rejects.toMatchObject({ code: Code.Unimplemented })
  })

  it('treats an unexpected close as unavailable', async () => {
    const { sockets, factory } = setup()
    const iterator = wsServerStream(endpoint, method, {}, new AbortController().signal, factory)
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
    const iterator = wsServerStream(endpoint, method, {}, controller.signal, factory)
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
      factory,
    )
    void iterator.next()
    sockets[0].open()

    expect(new TextDecoder().decode(sockets[0].sent[0])).not.toContain('authorization')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm -C fork-test exec vitest run singbox/api/websocket.test.ts`
Expected: FAIL，提示找不到 `@/assembly/singbox/api/endpoint`。

- [ ] **Step 3: 实现 endpoint.ts**

```ts
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
```

- [ ] **Step 4: 实现 websocket.ts**

```ts
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
  const code = Number(metadata['grpc-status'] ?? Code.Unknown)

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

export async function* wsServerStream<I extends DescMessage, O extends DescMessage>(
  endpoint: SingboxEndpoint,
  method: DescMethodServerStreaming<I, O>,
  request: MessageInitShape<I>,
  signal: AbortSignal,
  createSocket: SocketFactory = defaultSocket,
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

  socket.binaryType = 'arraybuffer'
  socket.onopen = () => {
    const headers: Record<string, string> = {
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
    signal.removeEventListener('abort', onAbort)
    if (socket.readyState < CLOSING) socket.close()
  }
}
```

注意：测试里的 FakeSocket 只传 `{ reason }` / `{ data }`，与 `CloseEvent` / `MessageEvent` 在运行时兼容；类型上由 `as unknown as WebSocket` 兜住。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm -C fork-test exec vitest run singbox/api/websocket.test.ts`
Expected: PASS（9 个用例）。

- [ ] **Step 6: 全量检查并提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test
git add src/assembly/singbox/api/endpoint.ts src/assembly/singbox/api/websocket.ts fork-test/singbox/api/websocket.test.ts
git commit -m "feat(singbox): add grpc-websockets server streaming transport"
```

---

### Task 3: 常驻流封装

**Files:**
- Create: `src/assembly/singbox/api/stream.ts`
- Test: `fork-test/singbox/api/stream.test.ts`

**Interfaces:**
- Produces:
  - `type StreamPhase = 'idle' | 'connecting' | 'active' | 'error'`
  - `type SharedStream<T> = { subscribe(listener: (value: T) => void): () => void; retryNow(): void; phase: Ref<StreamPhase>; error: ShallowRef<unknown> }`
  - `createSharedStream<T>(open: (signal: AbortSignal) => AsyncIterable<T>, options?: { onTerminal?: (error: unknown) => void }): SharedStream<T>`
  - `backoffDelay(attempt: number): number`（`min(1000 × attempt, 5000)`）
  - `isTerminal(error: unknown): boolean`（Unauthenticated / PermissionDenied / Unimplemented）
  - `retryAllStreams(): void`

- [ ] **Step 1: 写失败的测试**

`fork-test/singbox/api/stream.test.ts`：

```ts
import {
  backoffDelay,
  createSharedStream,
  isTerminal,
  retryAllStreams,
} from '@/assembly/singbox/api/stream'
import { Code, ConnectError } from '@connectrpc/connect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Session = {
  signal: AbortSignal
  emit: (value: number) => void
  fail: (error: unknown) => void
  end: () => void
}

const harness = () => {
  const sessions: Session[] = []
  const open = (signal: AbortSignal): AsyncIterable<number> => ({
    [Symbol.asyncIterator]() {
      const queue: number[] = []
      let error: unknown
      let done = false
      let wake: (() => void) | undefined
      const poke = () => {
        wake?.()
        wake = undefined
      }

      sessions.push({
        signal,
        emit: (value) => {
          queue.push(value)
          poke()
        },
        fail: (e) => {
          error = e
          poke()
        },
        end: () => {
          done = true
          poke()
        },
      })
      signal.addEventListener('abort', () => {
        done = true
        poke()
      })

      return {
        async next(): Promise<IteratorResult<number>> {
          while (true) {
            if (queue.length) return { value: queue.shift() as number, done: false }
            if (error) throw error
            if (done) return { value: undefined, done: true }
            await new Promise<void>((resolve) => (wake = resolve))
          }
        },
      }
    },
  })

  return { sessions, open }
}

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('helpers', () => {
  it('backs off linearly up to 5s', () => {
    expect([1, 2, 3, 5, 9].map(backoffDelay)).toEqual([1000, 2000, 3000, 5000, 5000])
  })

  it('detects terminal codes', () => {
    expect(isTerminal(new ConnectError('', Code.Unauthenticated))).toBe(true)
    expect(isTerminal(new ConnectError('', Code.PermissionDenied))).toBe(true)
    expect(isTerminal(new ConnectError('', Code.Unimplemented))).toBe(true)
    expect(isTerminal(new ConnectError('', Code.Unavailable))).toBe(false)
    expect(isTerminal(new Error('x'))).toBe(false)
  })
})

describe('createSharedStream', () => {
  it('starts lazily, shares one session and stops with the last subscriber', async () => {
    const h = harness()
    const stream = createSharedStream(h.open)
    const a: number[] = []
    const b: number[] = []

    expect(h.sessions).toHaveLength(0)
    const offA = stream.subscribe((value) => a.push(value))
    const offB = stream.subscribe((value) => b.push(value))
    await tick()
    expect(h.sessions).toHaveLength(1)
    expect(stream.phase.value).toBe('connecting')

    h.sessions[0].emit(1)
    await tick()
    expect(a).toEqual([1])
    expect(b).toEqual([1])
    expect(stream.phase.value).toBe('active')

    offA()
    expect(h.sessions[0].signal.aborted).toBe(false)
    offB()
    expect(h.sessions[0].signal.aborted).toBe(true)
    expect(stream.phase.value).toBe('idle')
  })

  it('reconnects with backoff and resets the attempt after a message', async () => {
    const h = harness()
    const stream = createSharedStream(h.open)

    stream.subscribe(() => {})
    await tick()
    h.sessions[0].fail(new ConnectError('down', Code.Unavailable))
    await tick(999)
    expect(h.sessions).toHaveLength(1)
    await tick(1)
    expect(h.sessions).toHaveLength(2)

    h.sessions[1].end()
    await tick(1999)
    expect(h.sessions).toHaveLength(2)
    await tick(1)
    expect(h.sessions).toHaveLength(3)

    h.sessions[2].emit(1)
    await tick()
    h.sessions[2].fail(new ConnectError('down', Code.Unavailable))
    await tick(1000)
    expect(h.sessions).toHaveLength(4)
  })

  it('stops on terminal codes and reports them', async () => {
    const h = harness()
    const onTerminal = vi.fn()
    const stream = createSharedStream(h.open, { onTerminal })

    stream.subscribe(() => {})
    await tick()
    h.sessions[0].fail(new ConnectError('bad', Code.Unauthenticated))
    await tick(10_000)

    expect(h.sessions).toHaveLength(1)
    expect(stream.phase.value).toBe('error')
    expect(onTerminal).toHaveBeenCalledOnce()
  })

  it('retryNow skips the backoff wait', async () => {
    const h = harness()
    const stream = createSharedStream(h.open)

    stream.subscribe(() => {})
    await tick()
    h.sessions[0].fail(new ConnectError('down', Code.Unavailable))
    await tick()
    stream.retryNow()
    await tick()
    expect(h.sessions).toHaveLength(2)

    h.sessions[1].fail(new ConnectError('down', Code.Unavailable))
    await tick()
    retryAllStreams()
    await tick()
    expect(h.sessions).toHaveLength(3)
  })

  it('does not reconnect after the last subscriber leaves during backoff', async () => {
    const h = harness()
    const stream = createSharedStream(h.open)
    const off = stream.subscribe(() => {})

    await tick()
    h.sessions[0].fail(new ConnectError('down', Code.Unavailable))
    await tick()
    off()
    await tick(10_000)
    expect(h.sessions).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm -C fork-test exec vitest run singbox/api/stream.test.ts`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现 stream.ts**

```ts
import { Code, ConnectError } from '@connectrpc/connect'
import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'

export type StreamPhase = 'idle' | 'connecting' | 'active' | 'error'

export type SharedStream<T> = {
  subscribe(listener: (value: T) => void): () => void
  retryNow(): void
  phase: Ref<StreamPhase>
  error: ShallowRef<unknown>
}

const TERMINAL_CODES = new Set([Code.Unauthenticated, Code.PermissionDenied, Code.Unimplemented])
const streams = new Set<{ retryNow(): void }>()

export const backoffDelay = (attempt: number) => Math.min(1000 * attempt, 5000)

export const isTerminal = (error: unknown) =>
  error instanceof ConnectError && TERMINAL_CODES.has(error.code)

export const retryAllStreams = () => streams.forEach((stream) => stream.retryNow())

export const createSharedStream = <T>(
  open: (signal: AbortSignal) => AsyncIterable<T>,
  options: { onTerminal?: (error: unknown) => void } = {},
): SharedStream<T> => {
  const listeners = new Set<(value: T) => void>()
  const phase = ref<StreamPhase>('idle')
  const error = shallowRef<unknown>()
  let controller: AbortController | undefined
  let skipWait: (() => void) | undefined

  const wait = (signal: AbortSignal, ms: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', done)
        skipWait = undefined
        resolve()
      }
      const timer = setTimeout(done, ms)

      skipWait = done
      signal.addEventListener('abort', done, { once: true })
    })

  const run = async (signal: AbortSignal) => {
    let attempt = 0

    while (!signal.aborted) {
      phase.value = 'connecting'

      try {
        for await (const value of open(signal)) {
          if (signal.aborted) return
          attempt = 0
          phase.value = 'active'
          error.value = undefined
          listeners.forEach((listener) => listener(value))
        }
      } catch (e) {
        if (signal.aborted) return
        error.value = e
        if (isTerminal(e)) {
          phase.value = 'error'
          options.onTerminal?.(e)
          return
        }
      }

      if (signal.aborted) return
      attempt += 1
      await wait(signal, backoffDelay(attempt))
    }
  }

  const stop = () => {
    controller?.abort()
    controller = undefined
    phase.value = 'idle'
    error.value = undefined
  }

  const stream: SharedStream<T> = {
    phase,
    error,
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) {
        controller = new AbortController()
        void run(controller.signal)
      }

      return () => {
        if (!listeners.delete(listener)) return
        if (listeners.size === 0) stop()
      }
    },
    retryNow() {
      skipWait?.()
    },
  }

  streams.add(stream)
  return stream
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm -C fork-test exec vitest run singbox/api/stream.test.ts`
Expected: PASS（7 个用例）。

- [ ] **Step 5: 全量检查并提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test
git add src/assembly/singbox/api/stream.ts fork-test/singbox/api/stream.test.ts
git commit -m "feat(singbox): add shared reconnecting stream"
```

---

### Task 4: 状态、能力表与 driver 选择

**Files:**
- Create: `src/assembly/singbox/api/state.ts`, `src/assembly/driver/singbox-api.ts`
- Modify: `src/assembly/singbox/capabilities.ts`, `src/assembly/backend.ts:1-21,33-76,149-155`, `src/assembly/driver/index.ts`
- Test: `fork-test/singbox/api/capabilities.test.ts`, `fork-test/singbox/api/driver.test.ts`

**Interfaces:**
- Produces:
  - `state.ts`：`type SingboxApiInfo = { version: string; apiVersion: number }`，`type SingboxApiError = 'unauthorized' | 'unimplemented' | 'timeout' | 'network'`，`type SingboxRuntime = { startedAt: number; goroutines: number; connectionsIn: number; connectionsOut: number }`，`singboxApi: ShallowRef<SingboxApiInfo | undefined>`，`singboxApiError: Ref<SingboxApiError | undefined>`，`singboxStreamError: Ref<string | undefined>`，`singboxRuntime: Ref<SingboxRuntime | undefined>`，`resetSingboxApi(): void`。Task 5 会再加 `singboxApiModule`。
  - `singboxCaps(variant, forkOverride, api?: { apiVersion: number })`，新 Cap：`'singboxApi' | 'tools' | 'tailscale' | 'openvpn' | 'openconnect' | 'ebpfDiagnostics'`（`backendEvents` 已存在）。
  - `singboxApiDriver: Driver`（本任务先是 `{ ...singboxDriver }`）。

- [ ] **Step 1: 写失败的测试**

`fork-test/singbox/api/capabilities.test.ts`：

```ts
import type { Cap } from '@/assembly/backend'
import { singboxCaps } from '@/assembly/singbox/capabilities'
import { describe, expect, it } from 'vitest'

const API_CAPS: Cap[] = [
  'singboxApi',
  'tools',
  'backendEvents',
  'tailscale',
  'openvpn',
  'openconnect',
  'ebpfDiagnostics',
]

describe('singboxCaps with sing-box API', () => {
  it('keeps the Clash-only matrix without api', () => {
    const caps = singboxCaps('moonfruit', false)

    for (const cap of API_CAPS) expect(caps[cap]).toBe(false)
    expect(caps.coreRestart).toBe(true)
  })

  it('gates tool caps by api version', () => {
    const v3 = singboxCaps('moonfruit', false, { apiVersion: 3 })
    const v2 = singboxCaps('moonfruit', false, { apiVersion: 2 })
    const v5 = singboxCaps('moonfruit', false, { apiVersion: 5 })

    expect(v2.singboxApi).toBe(true)
    expect(v2.tools).toBe(true)
    expect(v2.backendEvents).toBe(true)
    expect(v2.tailscale).toBe(false)
    expect(v3.tailscale).toBe(true)
    expect(v3.openvpn).toBe(true)
    expect(v3.openconnect).toBe(true)
    expect(v3.ebpfDiagnostics).toBe(false)
    expect(v5.ebpfDiagnostics).toBe(true)
  })

  it('does not change the other caps', () => {
    const without = singboxCaps('moonfruit', false)
    const withApi = singboxCaps('moonfruit', false, { apiVersion: 5 })

    for (const [cap, value] of Object.entries(without)) {
      if (!API_CAPS.includes(cap as Cap)) expect(withApi[cap as Cap]).toBe(value)
    }
  })
})
```

`fork-test/singbox/api/driver.test.ts`：

```ts
import { can, core, Core, resetCore } from '@/assembly/backend'
import { driver } from '@/assembly/driver'
import { singboxDriver } from '@/assembly/driver/singbox'
import { singboxApiDriver } from '@/assembly/driver/singbox-api'
import {
  singboxApi,
  singboxApiError,
  singboxRuntime,
  singboxStreamError,
} from '@/assembly/singbox/api/state'
import { singboxVariant } from '@/assembly/singbox/variant'
import { backendList, setActiveBackend } from '@/store/setup'
import { beforeEach, describe, expect, it } from 'vitest'

const backend = {
  type: 'clash' as const,
  protocol: 'http',
  host: '127.0.0.1',
  port: '9090',
  secondaryPath: '',
  password: '',
  uuid: 'api-backend',
}

beforeEach(() => {
  backendList.value = [backend]
  setActiveBackend(backend.uuid)
  resetCore()
})

describe('sing-box API driver selection', () => {
  it('uses the API driver only when the API was probed', () => {
    core.value = Core.Singbox
    singboxVariant.value = 'moonfruit'
    expect(driver()).toBe(singboxDriver)

    singboxApi.value = { version: '1.15.0-moonfruit', apiVersion: 5 }
    expect(driver()).toBe(singboxApiDriver)
    expect(can('singboxApi')).toBe(true)
    expect(can('ebpfDiagnostics')).toBe(true)
  })

  it('ignores the API on other cores', () => {
    core.value = Core.Mihomo
    singboxApi.value = { version: 'x', apiVersion: 5 }
    expect(driver()).not.toBe(singboxApiDriver)
    expect(can('singboxApi')).toBe(false)
  })

  it('resetCore clears API state', () => {
    singboxApi.value = { version: 'x', apiVersion: 5 }
    singboxApiError.value = 'unauthorized'
    singboxStreamError.value = 'bad'
    singboxRuntime.value = { startedAt: 1, goroutines: 1, connectionsIn: 1, connectionsOut: 1 }

    resetCore()

    expect(singboxApi.value).toBeUndefined()
    expect(singboxApiError.value).toBeUndefined()
    expect(singboxStreamError.value).toBeUndefined()
    expect(singboxRuntime.value).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm -C fork-test exec vitest run singbox/api/capabilities.test.ts singbox/api/driver.test.ts`
Expected: FAIL（找不到 `state` / `singbox-api` 模块，`singboxCaps` 不认第三个参数）。

- [ ] **Step 3: 实现 state.ts**

```ts
import { ref, shallowRef } from 'vue'

export type SingboxApiInfo = {
  version: string
  apiVersion: number
}

export type SingboxApiError = 'unauthorized' | 'unimplemented' | 'timeout' | 'network'

export type SingboxRuntime = {
  startedAt: number
  goroutines: number
  connectionsIn: number
  connectionsOut: number
}

export const singboxApi = shallowRef<SingboxApiInfo>()
export const singboxApiError = ref<SingboxApiError>()
export const singboxStreamError = ref<string>()
export const singboxRuntime = ref<SingboxRuntime>()

export const resetSingboxApi = () => {
  singboxApi.value = undefined
  singboxApiError.value = undefined
  singboxStreamError.value = undefined
  singboxRuntime.value = undefined
}
```

- [ ] **Step 4: 扩展 singboxCaps**

`src/assembly/singbox/capabilities.ts` 改为：

```ts
import type { Cap } from '../backend'
import type { SingboxVariant } from './variant'

export type SingboxApiCaps = {
  apiVersion: number
}

export const singboxCaps = (
  variant: SingboxVariant,
  forkOverride: boolean,
  api?: SingboxApiCaps,
): Partial<Record<Cap, boolean>> => {
  const refind = variant !== 'official'
  const apiVersion = api?.apiVersion ?? 0

  return {
    coreUpgrade: forkOverride,
    coreRestart: refind || forkOverride,
    dashboardUpgrade: true,
    reloadConfigs: refind || forkOverride,
    updateConfigs: forkOverride,
    updateGeoDatabase: forkOverride,
    syncSettings: forkOverride,
    independentLatency: true,

    traceLogLevel: true,
    extraLogLevels: true,

    customGlobalNode: true,
    logTypeFilter: true,
    logConnectionDetail: true,
    disconnectOnModeChange: true,
    modeSwitch: true,

    latencyTest: true,
    proxyProviderUpdate: refind,
    proxyProviderHealthCheck: refind,
    ruleProviders: refind,
    flushDNSCache: true,
    flushFakeIP: true,
    dnsQuery: true,
    connectionsClose: true,
    customTestUrl: true,
    nodeLatencyTest: true,

    singboxApi: !!api,
    tools: !!api,
    backendEvents: !!api,
    tailscale: !!api && apiVersion >= 3,
    openvpn: !!api && apiVersion >= 3,
    openconnect: !!api && apiVersion >= 3,
    ebpfDiagnostics: !!api && apiVersion >= 5,
  }
}
```

- [ ] **Step 5: backend.ts 挂接**

1. 在 `Cap` 联合类型末尾（`| 'modeSwitch'` 之后）加：

```ts
  | 'singboxApi'
  | 'tools'
  | 'tailscale'
  | 'openvpn'
  | 'openconnect'
  | 'ebpfDiagnostics'
```

2. 在 imports 里加：

```ts
import { resetSingboxApi, singboxApi } from './singbox/api/state'
```

3. `resetCore` 改为：

```ts
export const resetCore = () => {
  core.value = Core.Unknown
  singboxVariant.value = undefined
  resetSingboxApi()
}
```

4. `soft` 里的 sing-box 分支改为：

```ts
    return singboxCaps(singboxVariant.value ?? 'official', isForkCoreOverride.value, singboxApi.value)
```

- [ ] **Step 6: driver 选择**

新建 `src/assembly/driver/singbox-api.ts`：

```ts
import { singboxDriver } from './singbox'
import type { Driver } from './types'

export const singboxApiDriver: Driver = {
  ...singboxDriver,
}
```

`src/assembly/driver/index.ts`：加 imports

```ts
import { singboxApi } from '@/assembly/singbox/api/state'
import { singboxApiDriver } from './singbox-api'
```

`driver` 改为：

```ts
export const driver = () => {
  const selected = driverFor(activeBackend.value)

  if (selected !== clashDriver || core.value !== Core.Singbox) return selected

  return singboxApi.value ? singboxApiDriver : singboxDriver
}
```

- [ ] **Step 7: 运行测试确认通过**

Run: `pnpm -C fork-test exec vitest run singbox/api/capabilities.test.ts singbox/api/driver.test.ts singbox/driver.test.ts singbox/capabilities.test.ts`
Expected: PASS（新旧测试都通过）。

- [ ] **Step 8: 全量检查并提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test
git add src/assembly/singbox/api/state.ts src/assembly/singbox/capabilities.ts src/assembly/backend.ts src/assembly/driver/singbox-api.ts src/assembly/driver/index.ts fork-test/singbox/api/capabilities.test.ts fork-test/singbox/api/driver.test.ts
git commit -m "feat(singbox): select sing-box API driver and capabilities after probe"
```

---
### Task 5: 客户端、探测与状态行

**Files:**
- Create: `src/assembly/singbox/api/client.ts`, `src/assembly/singbox/api/runtime.ts`, `src/assembly/singbox/api/probe.ts`, `src/assembly/singbox/api-status.ts`, `src/i18n/singbox/en.ts`, `src/i18n/singbox/zh.ts`, `src/i18n/singbox/zh-tw.ts`, `src/i18n/singbox/ru.ts`, `src/components/singbox/SingboxApiStatus.vue`
- Modify: `src/assembly/singbox/api/state.ts`, `src/assembly/version.ts:14-15,98-102`, `src/i18n/en.ts:1`, `src/i18n/zh.ts:1-3`, `src/i18n/zh-tw.ts:1-3`, `src/i18n/ru.ts:1-3`, `src/components/settings/backend/BackendSettings.vue:32,176-182`
- Test: `fork-test/singbox/api/probe.test.ts`

**Interfaces:**
- Consumes: `endpointOf`、`wsServerStream`（Task 2），state（Task 4）。
- Produces:
  - `client.ts`：`type StartedServiceClient = Client<typeof StartedService>`；`createServiceClient(endpoint): StartedServiceClient`；`activeEndpoint(): SingboxEndpoint`（无后端时抛 `ConnectError(Code.Unavailable)`）；`api(): StartedServiceClient`（按 endpoint 缓存）；`serverStream(method, request, signal)`（走 `wsServerStream`、使用 `activeEndpoint()`）；`toApiError(error): SingboxApiError`；`type ProbeResult = { ok: true; info: SingboxApiInfo; startedAt: number } | { ok: false; error: SingboxApiError }`；`probe(endpoint, timeoutMs = 3000): Promise<ProbeResult>`。
  - `runtime.ts`：懒加载入口，本任务导出 `api`、`probe`、`serverStream`、`toApiError`。
  - `state.ts` 新增 `singboxApiModule: ShallowRef<typeof import('./runtime') | undefined>`。
  - `probeSingboxApi(backend: Backend): Promise<void>`（永不抛出）。
  - `singboxApiStatus: ComputedRef<SingboxApiStatus | undefined>`，`type SingboxApiStatus = { state: 'connected'; apiVersion: number } | { state: 'failed'; reason: SingboxApiError } | { state: 'stream-error'; message: string }`。
  - i18n：`src/i18n/singbox/en.ts` 导出 `singboxEn`，`zh.ts` 导出 `singboxZh: typeof singboxEn`，`zh-tw.ts` 导出 `singboxZhTW`，`ru.ts` 导出 `singboxRu`。后续任务只往这四个文件里加键。

- [ ] **Step 1: 写失败的测试**

`fork-test/singbox/api/probe.test.ts`：

```ts
import { singboxApiStatus } from '@/assembly/singbox/api-status'
import { toApiError } from '@/assembly/singbox/api/client'
import { probeSingboxApi } from '@/assembly/singbox/api/probe'
import * as runtime from '@/assembly/singbox/api/runtime'
import {
  resetSingboxApi,
  singboxApi,
  singboxApiError,
  singboxApiModule,
  singboxRuntime,
  singboxStreamError,
} from '@/assembly/singbox/api/state'
import { singboxVariant } from '@/assembly/singbox/variant'
import { backendList, setActiveBackend } from '@/store/setup'
import { Code, ConnectError } from '@connectrpc/connect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/assembly/singbox/api/runtime', () => ({ probe: vi.fn() }))

const backend = {
  type: 'clash' as const,
  protocol: 'http',
  host: '127.0.0.1',
  port: '9090',
  secondaryPath: '/ui',
  password: 'pw',
  uuid: 'a',
}
const other = { ...backend, uuid: 'b', port: '9091' }
const info = { version: '1.15.0-moonfruit', apiVersion: 5 }

beforeEach(() => {
  backendList.value = [backend, other]
  setActiveBackend(backend.uuid)
  resetSingboxApi()
  singboxApiModule.value = undefined
  singboxVariant.value = 'moonfruit'
  vi.mocked(runtime.probe).mockReset()
})

describe('toApiError', () => {
  it('maps connect codes', () => {
    expect(toApiError(new ConnectError('', Code.Unauthenticated))).toBe('unauthorized')
    expect(toApiError(new ConnectError('', Code.PermissionDenied))).toBe('unauthorized')
    expect(toApiError(new ConnectError('', Code.Unimplemented))).toBe('unimplemented')
    expect(toApiError(new ConnectError('', Code.NotFound))).toBe('unimplemented')
    expect(toApiError(new ConnectError('', Code.DeadlineExceeded))).toBe('timeout')
    expect(toApiError(new ConnectError('', Code.Unavailable))).toBe('network')
    expect(toApiError(new Error('x'))).toBe('network')
  })
})

describe('probeSingboxApi', () => {
  it('stores api info, runtime module and start time', async () => {
    vi.mocked(runtime.probe).mockResolvedValue({ ok: true, info, startedAt: 1000 })

    await probeSingboxApi(backend)

    expect(runtime.probe).toHaveBeenCalledWith({ baseUrl: 'http://127.0.0.1:9090', secret: 'pw' })
    expect(singboxApi.value).toEqual(info)
    expect(singboxApiModule.value).toBeDefined()
    expect(singboxRuntime.value?.startedAt).toBe(1000)
    expect(singboxApiStatus.value).toEqual({ state: 'connected', apiVersion: 5 })
  })

  it('records the failure reason and keeps the Clash path', async () => {
    vi.mocked(runtime.probe).mockResolvedValue({ ok: false, error: 'unauthorized' })

    await probeSingboxApi(backend)

    expect(singboxApi.value).toBeUndefined()
    expect(singboxApiError.value).toBe('unauthorized')
    expect(singboxApiStatus.value).toEqual({ state: 'failed', reason: 'unauthorized' })
  })

  it('never throws', async () => {
    vi.mocked(runtime.probe).mockRejectedValue(new Error('boom'))

    await expect(probeSingboxApi(backend)).resolves.toBeUndefined()
    expect(singboxApiError.value).toBe('network')
  })

  it('drops a result that arrives after the backend changed', async () => {
    let resolve: (value: Awaited<ReturnType<typeof runtime.probe>>) => void = () => {}
    vi.mocked(runtime.probe).mockReturnValue(new Promise((r) => (resolve = r)))

    const pending = probeSingboxApi(backend)
    await vi.waitFor(() => expect(runtime.probe).toHaveBeenCalled())
    setActiveBackend(other.uuid)
    resolve({ ok: true, info, startedAt: 1 })
    await pending

    expect(singboxApi.value).toBeUndefined()
    expect(singboxApiError.value).toBeUndefined()
  })
})

describe('singboxApiStatus', () => {
  it('is hidden outside moonfruit and prefers stream errors', () => {
    singboxApi.value = info
    singboxVariant.value = 'refind'
    expect(singboxApiStatus.value).toBeUndefined()

    singboxVariant.value = 'moonfruit'
    singboxStreamError.value = 'bad secret'
    expect(singboxApiStatus.value).toEqual({ state: 'stream-error', message: 'bad secret' })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm -C fork-test exec vitest run singbox/api/probe.test.ts`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现 client.ts 与 runtime.ts**

`src/assembly/singbox/api/client.ts`：

```ts
import { language } from '@/store/settings'
import { activeBackend } from '@/store/setup'
import type {
  DescMessage,
  DescMethodServerStreaming,
  MessageInitShape,
} from '@bufbuild/protobuf'
import { Code, ConnectError, createClient, type Client, type Interceptor } from '@connectrpc/connect'
import { createGrpcWebTransport } from '@connectrpc/connect-web'
import { endpointOf, type SingboxEndpoint } from './endpoint'
import { StartedService } from './gen/daemon/started_service_pb'
import type { SingboxApiError, SingboxApiInfo } from './state'
import { wsServerStream } from './websocket'

export type StartedServiceClient = Client<typeof StartedService>

export type ProbeResult =
  | { ok: true; info: SingboxApiInfo; startedAt: number }
  | { ok: false; error: SingboxApiError }

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
) => wsServerStream(activeEndpoint(), method, request, signal)

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
      startedAt: started ? Number(started.startedAt) : Date.now(),
    }
  } catch (error) {
    return { ok: false, error: toApiError(error) }
  }
}
```

`src/assembly/singbox/api/runtime.ts`：

```ts
export { api, probe, serverStream, toApiError } from './client'
```

- [ ] **Step 4: state 加 module ref，实现 probe.ts 与 api-status.ts**

`state.ts` 在 `singboxRuntime` 之后加一行：

```ts
export const singboxApiModule = shallowRef<typeof import('./runtime')>()
```

`src/assembly/singbox/api/probe.ts`：

```ts
import { activeBackend } from '@/store/setup'
import type { Backend } from '@/types'
import { endpointOf } from './endpoint'
import { singboxApi, singboxApiError, singboxApiModule, singboxRuntime } from './state'

export const probeSingboxApi = async (backend: Backend) => {
  const isActive = () => activeBackend.value?.uuid === backend.uuid

  try {
    const runtime = await import('./runtime')
    const result = await runtime.probe(endpointOf(backend))

    if (!isActive()) return
    if (!result.ok) {
      singboxApiError.value = result.error
      return
    }

    singboxApiModule.value = runtime
    singboxRuntime.value = {
      startedAt: result.startedAt,
      goroutines: 0,
      connectionsIn: 0,
      connectionsOut: 0,
    }
    singboxApi.value = result.info
  } catch {
    if (isActive()) singboxApiError.value = 'network'
  }
}
```

`src/assembly/singbox/api-status.ts`：

```ts
import { computed } from 'vue'
import {
  singboxApi,
  singboxApiError,
  singboxStreamError,
  type SingboxApiError,
} from './api/state'
import { singboxVariant } from './variant'

export type SingboxApiStatus =
  | { state: 'connected'; apiVersion: number }
  | { state: 'failed'; reason: SingboxApiError }
  | { state: 'stream-error'; message: string }

export const singboxApiStatus = computed<SingboxApiStatus | undefined>(() => {
  if (singboxVariant.value !== 'moonfruit') return undefined
  if (singboxStreamError.value) return { state: 'stream-error', message: singboxStreamError.value }
  if (singboxApi.value) return { state: 'connected', apiVersion: singboxApi.value.apiVersion }
  if (singboxApiError.value) return { state: 'failed', reason: singboxApiError.value }
  return undefined
})
```

- [ ] **Step 5: version.ts 挂接**

imports 里加：

```ts
import { probeSingboxApi } from './singbox/api/probe'
```

在 `probeBackendVersion` 中 `singboxVariant.value = ...` 赋值语句之后加：

```ts
  if (singboxVariant.value === 'moonfruit') {
    await probeSingboxApi(backend)
  }
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm -C fork-test exec vitest run singbox/api/probe.test.ts`
Expected: PASS（6 个用例）。

- [ ] **Step 7: fork i18n 文件与挂接**

`src/i18n/singbox/en.ts`：

```ts
export const singboxEn = {
  singboxApi: 'sing-box API',
  singboxApiConnected: 'Connected (API version {version})',
  singboxApiUnauthorized: 'Unauthorized: the API service secret must match the Clash API secret',
  singboxApiUnimplemented:
    'Not available: serve the API service on the same address and port as external_controller',
  singboxApiTimeout: 'Timed out',
  singboxApiNetwork:
    'Not reachable: serve the API service on the same address and port as external_controller',
  singboxApiStreamError: 'Stream stopped: {message}',
}
```

`src/i18n/singbox/zh.ts`：

```ts
import type { singboxEn } from './en'

export const singboxZh: typeof singboxEn = {
  singboxApi: 'sing-box API',
  singboxApiConnected: '已连接（API 版本 {version}）',
  singboxApiUnauthorized: '未授权：API service 的 secret 需要与 Clash API 的 secret 一致',
  singboxApiUnimplemented: '未启用：需要把 API service 配置在与 external_controller 相同的地址端口上',
  singboxApiTimeout: '连接超时',
  singboxApiNetwork: '无法连接：需要把 API service 配置在与 external_controller 相同的地址端口上',
  singboxApiStreamError: '数据流已停止：{message}',
}
```

`src/i18n/singbox/zh-tw.ts`：

```ts
import type { singboxEn } from './en'

export const singboxZhTW: typeof singboxEn = {
  singboxApi: 'sing-box API',
  singboxApiConnected: '已連接（API 版本 {version}）',
  singboxApiUnauthorized: '未授權：API service 的 secret 需要與 Clash API 的 secret 一致',
  singboxApiUnimplemented: '未啟用：需要把 API service 配置在與 external_controller 相同的位址連接埠上',
  singboxApiTimeout: '連接逾時',
  singboxApiNetwork: '無法連接：需要把 API service 配置在與 external_controller 相同的位址連接埠上',
  singboxApiStreamError: '資料流已停止：{message}',
}
```

`src/i18n/singbox/ru.ts`：

```ts
import type { singboxEn } from './en'

export const singboxRu: typeof singboxEn = {
  singboxApi: 'sing-box API',
  singboxApiConnected: 'Подключено (версия API {version})',
  singboxApiUnauthorized: 'Нет доступа: secret API service должен совпадать с secret Clash API',
  singboxApiUnimplemented:
    'Недоступно: API service должен слушать тот же адрес и порт, что и external_controller',
  singboxApiTimeout: 'Время ожидания истекло',
  singboxApiNetwork:
    'Нет соединения: API service должен слушать тот же адрес и порт, что и external_controller',
  singboxApiStreamError: 'Поток остановлен: {message}',
}
```

挂接（每个文件两处）：

- `src/i18n/en.ts`：文件第一行前加 `import { singboxEn } from './singbox/en'` 和一个空行；`const en = {` 的下一行加 `  ...singboxEn,`。
- `src/i18n/zh.ts`：在 `import type { LANG_MESSAGE } from './en'` 之后加 `import { singboxZh } from './singbox/zh'`；`const zh: LANG_MESSAGE = {` 的下一行加 `  ...singboxZh,`。
- `src/i18n/zh-tw.ts`：同理加 `import { singboxZhTW } from './singbox/zh-tw'` 与 `  ...singboxZhTW,`。
- `src/i18n/ru.ts`：同理加 `import { singboxRu } from './singbox/ru'` 与 `  ...singboxRu,`。

- [ ] **Step 8: 状态行组件与挂接**

`src/components/singbox/SingboxApiStatus.vue`：

```vue
<template>
  <div
    v-if="status"
    class="flex flex-wrap items-center gap-2 px-1 text-xs"
  >
    <span class="text-base-content/60">{{ $t('singboxApi') }}</span>
    <span :class="status.ok ? 'text-success' : 'text-error'">{{ status.text }}</span>
  </div>
</template>

<script setup lang="ts">
import { singboxApiStatus } from '@/assembly/singbox/api-status'
import type { SingboxApiError } from '@/assembly/singbox/api/state'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const FAILURE_KEYS: Record<SingboxApiError, string> = {
  unauthorized: 'singboxApiUnauthorized',
  unimplemented: 'singboxApiUnimplemented',
  timeout: 'singboxApiTimeout',
  network: 'singboxApiNetwork',
}

const status = computed(() => {
  const value = singboxApiStatus.value

  if (!value) return undefined
  if (value.state === 'connected') {
    return { ok: true, text: t('singboxApiConnected', { version: String(value.apiVersion) }) }
  }
  if (value.state === 'stream-error') {
    return { ok: false, text: t('singboxApiStreamError', { message: value.message }) }
  }
  return { ok: false, text: t(FAILURE_KEYS[value.reason]) }
})
</script>
```

`src/components/settings/backend/BackendSettings.vue`：在 `<BackendSwitch :show-actions="false" />` 下一行加 `<SingboxApiStatus />`；imports 里在 `import SettingItem ...` 之前加 `import SingboxApiStatus from '@/components/singbox/SingboxApiStatus.vue'`。

- [ ] **Step 9: 全量检查、确认懒加载并提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test
pnpm build
rg -l "grpc-websockets|application/grpc-web" dist/assets/*.js
```

Expected：`rg` 列出的文件里**没有** `dist/assets/index-*.js`（主 chunk），只有懒加载的 runtime chunk。

```bash
git add src/assembly/singbox/api src/assembly/singbox/api-status.ts src/assembly/version.ts src/i18n src/components/singbox/SingboxApiStatus.vue src/components/settings/backend/BackendSettings.vue fork-test/singbox/api/probe.test.ts
git commit -m "feat(singbox): probe sing-box API on the Clash port and show its status"
```

---

### Task 6: 常驻流实例与 metrics

**Files:**
- Create: `src/assembly/singbox/api/streams.ts`, `src/assembly/singbox/status.ts`
- Modify: `src/assembly/singbox/api/runtime.ts`, `src/assembly/driver/singbox-api.ts`
- Test: `fork-test/singbox/api/status.test.ts`, `fork-test/singbox/api/fake-runtime.ts`

**Interfaces:**
- Consumes: `createSharedStream`、`retryAllStreams`（Task 3），`serverStream`（Task 5），`singboxApiModule`、`singboxRuntime`、`singboxStreamError`（Task 4/5）。
- Produces:
  - `streams.ts`：`statusStream: SharedStream<Status>`、`connectionsStream: SharedStream<ConnectionEvents>`、`logStream: SharedStream<Log>`、`groupsStream: SharedStream<Groups>`、`clashModeStream: SharedStream<ClashMode>`；`runtime.ts` 追加 `export * from './streams'`。
  - `status.ts`：`toTrafficSample(status: Status): TrafficSample`、`toMemorySample(status: Status): MemorySample`、`toRuntime(status: Status, previous?: SingboxRuntime): SingboxRuntime`。
  - `singbox-api.ts`：内部 helper `runtime()`（取已加载的模块，未加载时抛错）和 `fromShared(stream, map): Stream<T>`，后续任务复用。
  - 测试辅助 `fork-test/singbox/api/fake-runtime.ts`：`fakeShared<T>()`（`{ subscribe, emit, size }`）和 `installRuntime(partial)`。

- [ ] **Step 1: 写测试辅助与失败的测试**

`fork-test/singbox/api/fake-runtime.ts`：

```ts
import { singboxApiModule } from '@/assembly/singbox/api/state'

export const fakeShared = <T>() => {
  const listeners = new Set<(value: T) => void>()

  return {
    subscribe(listener: (value: T) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    retryNow() {},
    emit(value: T) {
      listeners.forEach((listener) => listener(value))
    },
    size: () => listeners.size,
  }
}

export const installRuntime = (partial: Record<string, unknown>) => {
  singboxApiModule.value = partial as unknown as typeof singboxApiModule.value
}
```

`fork-test/singbox/api/status.test.ts`：

```ts
import { singboxApiDriver } from '@/assembly/driver/singbox-api'
import { StatusSchema, type Status } from '@/assembly/singbox/api/gen/daemon/started_service_pb'
import { singboxRuntime } from '@/assembly/singbox/api/state'
import { toMemorySample, toRuntime, toTrafficSample } from '@/assembly/singbox/status'
import { create } from '@bufbuild/protobuf'
import { beforeEach, describe, expect, it } from 'vitest'
import { fakeShared, installRuntime } from './fake-runtime'

const status = create(StatusSchema, {
  memory: 1024n,
  goroutines: 12,
  connectionsIn: 3,
  connectionsOut: 4,
  uplink: 10n,
  downlink: 20n,
  uplinkTotal: 100n,
  downlinkTotal: 200n,
})

describe('status mapping', () => {
  it('maps traffic, memory and runtime', () => {
    expect(toTrafficSample(status)).toEqual({ down: 20, up: 10, downTotal: 200, upTotal: 100 })
    expect(toMemorySample(status)).toEqual({ inuse: 1024 })
    expect(
      toRuntime(status, { startedAt: 5, goroutines: 0, connectionsIn: 0, connectionsOut: 0 }),
    ).toEqual({ startedAt: 5, goroutines: 12, connectionsIn: 3, connectionsOut: 4 })
    expect(toRuntime(status).startedAt).toBe(0)
  })
})

describe('singboxApiDriver.metrics', () => {
  const stream = fakeShared<Status>()

  beforeEach(() => {
    installRuntime({ statusStream: stream })
    singboxRuntime.value = { startedAt: 7, goroutines: 0, connectionsIn: 0, connectionsOut: 0 }
  })

  it('shares one status stream for traffic and memory', () => {
    const traffic = singboxApiDriver.metrics.traffic()
    const memory = singboxApiDriver.metrics.memory()

    expect(stream.size()).toBe(2)
    stream.emit(status)

    expect(traffic.data.value).toEqual({ down: 20, up: 10, downTotal: 200, upTotal: 100 })
    expect(memory.data.value).toEqual({ inuse: 1024 })
    expect(singboxRuntime.value).toEqual({
      startedAt: 7,
      goroutines: 12,
      connectionsIn: 3,
      connectionsOut: 4,
    })

    traffic.close()
    memory.close()
    expect(stream.size()).toBe(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm -C fork-test exec vitest run singbox/api/status.test.ts`
Expected: FAIL，找不到 `@/assembly/singbox/status`。

- [ ] **Step 3: 实现 status.ts**

```ts
import type { MemorySample, TrafficSample } from '@/assembly/driver/types'
import type { Status } from './api/gen/daemon/started_service_pb'
import type { SingboxRuntime } from './api/state'

export const toTrafficSample = (status: Status): TrafficSample => ({
  down: Number(status.downlink),
  up: Number(status.uplink),
  downTotal: Number(status.downlinkTotal),
  upTotal: Number(status.uplinkTotal),
})

export const toMemorySample = (status: Status): MemorySample => ({
  inuse: Number(status.memory),
})

export const toRuntime = (status: Status, previous?: SingboxRuntime): SingboxRuntime => ({
  startedAt: previous?.startedAt ?? 0,
  goroutines: status.goroutines,
  connectionsIn: status.connectionsIn,
  connectionsOut: status.connectionsOut,
})
```

- [ ] **Step 4: 实现 streams.ts 并导出**

`src/assembly/singbox/api/streams.ts`：

```ts
import { ConnectError } from '@connectrpc/connect'
import { serverStream } from './client'
import { StartedService } from './gen/daemon/started_service_pb'
import { singboxStreamError } from './state'
import { createSharedStream, retryAllStreams } from './stream'

const SECOND = 1_000_000_000n

const options = {
  onTerminal: (error: unknown) => {
    singboxStreamError.value = ConnectError.from(error).rawMessage
  },
}

export const statusStream = createSharedStream(
  (signal) => serverStream(StartedService.method.subscribeStatus, { interval: SECOND }, signal),
  options,
)

export const connectionsStream = createSharedStream(
  (signal) =>
    serverStream(StartedService.method.subscribeConnections, { interval: SECOND }, signal),
  options,
)

export const logStream = createSharedStream(
  (signal) => serverStream(StartedService.method.subscribeLog, {}, signal),
  options,
)

export const groupsStream = createSharedStream(
  (signal) => serverStream(StartedService.method.subscribeGroups, {}, signal),
  options,
)

export const clashModeStream = createSharedStream(
  (signal) => serverStream(StartedService.method.subscribeClashMode, {}, signal),
  options,
)

if (typeof window !== 'undefined') {
  window.addEventListener('online', retryAllStreams)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') retryAllStreams()
  })
}
```

`runtime.ts` 追加一行：

```ts
export * from './streams'
```

- [ ] **Step 5: driver 接入 metrics**

`src/assembly/driver/singbox-api.ts` 改为：

```ts
import type { SharedStream } from '@/assembly/singbox/api/stream'
import { singboxApiModule, singboxRuntime } from '@/assembly/singbox/api/state'
import { toMemorySample, toRuntime, toTrafficSample } from '@/assembly/singbox/status'
import { shallowRef } from 'vue'
import { singboxDriver } from './singbox'
import type { Driver, Stream } from './types'

const runtime = () => {
  const module = singboxApiModule.value

  if (!module) throw new Error('sing-box API is not loaded')
  return module
}

const fromShared = <S, T>(stream: SharedStream<S>, map: (value: S) => T): Stream<T> => {
  const data = shallowRef<T>()
  const close = stream.subscribe((value) => {
    data.value = map(value)
  })

  return { data, close }
}

export const singboxApiDriver: Driver = {
  ...singboxDriver,
  metrics: {
    ...singboxDriver.metrics,
    traffic: () =>
      fromShared(runtime().statusStream, (status) => {
        singboxRuntime.value = toRuntime(status, singboxRuntime.value)
        return toTrafficSample(status)
      }),
    memory: () => fromShared(runtime().statusStream, toMemorySample),
  },
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm -C fork-test exec vitest run singbox/api/status.test.ts`
Expected: PASS。

- [ ] **Step 7: 全量检查并提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test
git add src/assembly/singbox/api/streams.ts src/assembly/singbox/api/runtime.ts src/assembly/singbox/status.ts src/assembly/driver/singbox-api.ts fork-test/singbox/api/status.test.ts fork-test/singbox/api/fake-runtime.ts
git commit -m "feat(singbox): read traffic and memory from the sing-box status stream"
```

---

### Task 7: 连接事件累加器与 connections driver

**Files:**
- Create: `src/types/singbox.d.ts`, `src/assembly/singbox/connection-events.ts`
- Modify: `src/types/index.d.ts:1-2,149`, `src/assembly/driver/singbox-api.ts`
- Test: `fork-test/singbox/api/connections.test.ts`

**Interfaces:**
- Consumes: `fromShared`/`runtime()`（Task 6），`connectionsStream`、`api()`（Task 5/6）。
- Produces:
  - `type SingboxConnectionRawMessage`（字段见 Step 3）
  - `toRawConnection(connection: PbConnection): SingboxConnectionRawMessage`
  - `createConnectionAccumulator(): { apply(message: ConnectionEvents): boolean; drain(): ConnectionsPayload; active(): SingboxConnectionRawMessage[] }`（`apply` 在消息带 reset 或 UPDATE 事件时返回 true）
  - `splitHostPort(address: string): [string, string]`、`singboxConnectionAccessor: ConnectionAccessor`
  - driver 常量 `CONNECTIONS_IDLE_EMIT = 1500`

- [ ] **Step 1: 写失败的测试**

`fork-test/singbox/api/connections.test.ts`：

```ts
import { singboxApiDriver } from '@/assembly/driver/singbox-api'
import {
  ConnectionEventsSchema,
  ConnectionEventType,
  ConnectionSchema,
  type ConnectionEvents,
} from '@/assembly/singbox/api/gen/daemon/started_service_pb'
import {
  createConnectionAccumulator,
  singboxConnectionAccessor,
  splitHostPort,
  toRawConnection,
} from '@/assembly/singbox/connection-events'
import type { Connection, SingboxConnectionRawMessage } from '@/types'
import { create, type MessageInitShape } from '@bufbuild/protobuf'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeShared, installRuntime } from './fake-runtime'

const pbConnection = (init: MessageInitShape<typeof ConnectionSchema>) =>
  create(ConnectionSchema, {
    inbound: 'tun-in',
    inboundType: 'tun',
    network: 'tcp',
    source: '172.19.0.1:50000',
    destination: '1.1.1.1:443',
    createdAt: 1000n,
    rule: 'rule_set=geosite-cn',
    outbound: 'proxy',
    outboundType: 'vless',
    chainList: ['node-a', 'proxy'],
    ...init,
  })

const events = (init: MessageInitShape<typeof ConnectionEventsSchema>) =>
  create(ConnectionEventsSchema, init)

const NEW = ConnectionEventType.CONNECTION_EVENT_NEW
const UPDATE = ConnectionEventType.CONNECTION_EVENT_UPDATE
const CLOSED = ConnectionEventType.CONNECTION_EVENT_CLOSED

const ids = (list: { id: string }[]) => list.map((item) => item.id)

describe('accumulator', () => {
  it('builds the active set from reset and splits already closed ones', () => {
    const acc = createConnectionAccumulator()
    const traffic = acc.apply(
      events({
        reset: true,
        events: [
          { type: NEW, id: 'a', connection: pbConnection({ id: 'a' }) },
          { type: NEW, id: 'b', connection: pbConnection({ id: 'b', closedAt: 5000n }) },
        ],
      }),
    )
    const payload = acc.drain()

    expect(traffic).toBe(true)
    expect(ids(payload.connections)).toEqual(['a'])
    expect(ids(payload.closed ?? [])).toEqual(['b'])
    expect(acc.drain().closed).toEqual([])
  })

  it('accumulates deltas and reports updates', () => {
    const acc = createConnectionAccumulator()

    acc.apply(events({ reset: true, events: [{ type: NEW, id: 'a', connection: pbConnection({ id: 'a', uplinkTotal: 1n, downlinkTotal: 2n }) }] }))
    expect(acc.apply(events({ events: [{ type: UPDATE, id: 'a', uplinkDelta: 10n, downlinkDelta: 20n }] }))).toBe(true)
    expect(acc.apply(events({ events: [{ type: NEW, id: 'c', connection: pbConnection({ id: 'c' }) }] }))).toBe(false)

    const [a] = acc.drain().connections as SingboxConnectionRawMessage[]
    expect(a.uplinkTotal).toBe(11)
    expect(a.downlinkTotal).toBe(22)
  })

  it('moves closed connections once and rebuilds on a later reset', () => {
    const acc = createConnectionAccumulator()

    acc.apply(events({ reset: true, events: [{ type: NEW, id: 'a', connection: pbConnection({ id: 'a' }) }] }))
    acc.apply(events({ events: [{ type: CLOSED, id: 'a', closedAt: 9000n }] }))
    const first = acc.drain()
    expect(ids(first.connections)).toEqual([])
    expect((first.closed as SingboxConnectionRawMessage[])[0].closedAt).toBe(9000)

    acc.apply(
      events({
        reset: true,
        events: [
          { type: NEW, id: 'a', connection: pbConnection({ id: 'a', closedAt: 9000n }) },
          { type: NEW, id: 'd', connection: pbConnection({ id: 'd' }) },
        ],
      }),
    )
    const second = acc.drain()
    expect(ids(second.connections)).toEqual(['d'])
    expect(second.closed).toEqual([])
  })
})

describe('accessor', () => {
  const raw = (init: MessageInitShape<typeof ConnectionSchema>) =>
    ({ ...toRawConnection(pbConnection({ id: 'x', ...init })), downloadSpeed: 0, uploadSpeed: 0 }) as Connection

  it('splits host and port', () => {
    expect(splitHostPort('1.2.3.4:80')).toEqual(['1.2.3.4', '80'])
    expect(splitHostPort('[::1]:53')).toEqual(['::1', '53'])
    expect(splitHostPort('example.com:443')).toEqual(['example.com', '443'])
    expect(splitHostPort('::1')).toEqual(['::1', ''])
  })

  it('maps connection fields', () => {
    const conn = raw({
      domain: 'example.com',
      processInfo: { processPath: '/usr/bin/curl' },
      user: 'alice',
      uplinkTotal: 5n,
      downlinkTotal: 6n,
    })
    const a = singboxConnectionAccessor

    expect(a.sourceIP(conn)).toBe('172.19.0.1')
    expect(a.sourcePort(conn)).toBe('50000')
    expect(a.host(conn)).toBe('example.com:443')
    expect(a.hostname(conn)).toBe('example.com')
    expect(a.destination(conn)).toBe('1.1.1.1')
    expect(a.process(conn)).toBe('curl')
    expect(a.chains(conn)).toEqual(['node-a', 'proxy'])
    expect(a.download(conn)).toBe(6)
    expect(a.upload(conn)).toBe(5)
    expect(a.start(conn)).toBe(1000)
    expect(a.networkType(conn)).toBe('tun/tun-in | tcp')
    expect(a.inboundUser(conn)).toBe('alice')
    expect(a.sniffHost(conn)).toBe('')
    expect(a.isDirect(conn)).toBe(false)
  })

  it('falls back when domain and process are missing', () => {
    const conn = raw({ destination: '[2001:db8::1]:443', rule: '', processInfo: { packageNames: ['com.app'] } })

    expect(singboxConnectionAccessor.host(conn)).toBe('[2001:db8::1]:443')
    expect(singboxConnectionAccessor.rule(conn)).toBe('final')
    expect(singboxConnectionAccessor.process(conn)).toBe('com.app')
  })
})

describe('singboxApiDriver.connections', () => {
  const stream = fakeShared<ConnectionEvents>()
  const closeConnection = vi.fn().mockResolvedValue({})
  const closeAllConnections = vi.fn().mockResolvedValue({})

  beforeEach(() => {
    vi.useFakeTimers()
    closeConnection.mockClear()
    closeAllConnections.mockClear()
    installRuntime({
      connectionsStream: stream,
      api: () => ({ closeConnection, closeAllConnections }),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits on reset and update messages, and on the idle timer otherwise', () => {
    const source = singboxApiDriver.connections.subscribe()

    stream.emit(events({ reset: true, events: [{ type: NEW, id: 'a', connection: pbConnection({ id: 'a' }) }] }))
    expect(ids(source.data.value?.connections ?? [])).toEqual(['a'])

    const before = source.data.value
    stream.emit(events({ events: [{ type: NEW, id: 'b', connection: pbConnection({ id: 'b' }) }] }))
    expect(source.data.value).toBe(before)

    vi.advanceTimersByTime(1500)
    expect(ids(source.data.value?.connections ?? [])).toEqual(['a', 'b'])

    stream.emit(events({ events: [{ type: UPDATE, id: 'a', downlinkDelta: 100n }] }))
    const [a] = source.data.value?.connections as SingboxConnectionRawMessage[]
    expect(a.downlinkTotal).toBe(100)

    source.close()
    expect(stream.size()).toBe(0)
  })

  it('closes one, all, or filtered connections', async () => {
    const source = singboxApiDriver.connections.subscribe()

    stream.emit(
      events({
        reset: true,
        events: [
          { type: NEW, id: 'a', connection: pbConnection({ id: 'a', network: 'udp' }) },
          { type: NEW, id: 'b', connection: pbConnection({ id: 'b', source: '10.0.0.2:1' }) },
        ],
      }),
    )

    await singboxApiDriver.connections.disconnect('a')
    expect(closeConnection).toHaveBeenCalledWith({ id: 'a' })

    await singboxApiDriver.connections.disconnectAll()
    expect(closeAllConnections).toHaveBeenCalledOnce()

    closeConnection.mockClear()
    await singboxApiDriver.connections.disconnectAll({ type: 'udp' })
    expect(closeConnection.mock.calls).toEqual([[{ id: 'a' }]])

    closeConnection.mockClear()
    await singboxApiDriver.connections.disconnectAll({ src: '10.0.0.2' })
    expect(closeConnection.mock.calls).toEqual([[{ id: 'b' }]])
    source.close()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm -C fork-test exec vitest run singbox/api/connections.test.ts`
Expected: FAIL，找不到 `connection-events` 模块。

- [ ] **Step 3: 类型挂接**

`src/types/singbox.d.ts`：

```ts
export type SingboxConnectionRawMessage = {
  id: string
  inbound: string
  inboundType: string
  ipVersion: number
  network: string
  source: string
  destination: string
  domain: string
  protocol: string
  user: string
  fromOutbound: string
  createdAt: number
  closedAt: number
  uplinkTotal: number
  downlinkTotal: number
  rule: string
  outbound: string
  outboundType: string
  chainList: string[]
  processPath: string
  packageNames: string[]
}
```

`src/types/index.d.ts`：

- 第 1 行 `export * from './dae'` 之后加 `export * from './singbox'`。
- 第 2 行 `import type { DaeConnectionRawMessage } from './dae'` 之后加 `import type { SingboxConnectionRawMessage } from './singbox'`。
- `ConnectionRawMessage` 改为：

```ts
export type ConnectionRawMessage =
  | ClashConnectionRawMessage
  | DaeConnectionRawMessage
  | SingboxConnectionRawMessage
```

- [ ] **Step 4: 实现 connection-events.ts**

```ts
import type { ConnectionAccessor, ConnectionsPayload } from '@/assembly/driver/types'
import type { Connection, SingboxConnectionRawMessage } from '@/types'
import type {
  ConnectionEvents,
  Connection as PbConnection,
} from './api/gen/daemon/started_service_pb'

const EVENT_NEW = 0
const EVENT_UPDATE = 1
const EVENT_CLOSED = 2
const CLOSED_ID_LIMIT = 5000

export const toRawConnection = (connection: PbConnection): SingboxConnectionRawMessage => ({
  id: connection.id,
  inbound: connection.inbound,
  inboundType: connection.inboundType,
  ipVersion: connection.ipVersion,
  network: connection.network,
  source: connection.source,
  destination: connection.destination,
  domain: connection.domain,
  protocol: connection.protocol,
  user: connection.user,
  fromOutbound: connection.fromOutbound,
  createdAt: Number(connection.createdAt),
  closedAt: Number(connection.closedAt),
  uplinkTotal: Number(connection.uplinkTotal),
  downlinkTotal: Number(connection.downlinkTotal),
  rule: connection.rule,
  outbound: connection.outbound,
  outboundType: connection.outboundType,
  chainList: [...connection.chainList],
  processPath: connection.processInfo?.processPath ?? '',
  packageNames: [...(connection.processInfo?.packageNames ?? [])],
})

export const createConnectionAccumulator = () => {
  let active = new Map<string, SingboxConnectionRawMessage>()
  const closedIds = new Set<string>()
  let pendingClosed: SingboxConnectionRawMessage[] = []

  const close = (connection: SingboxConnectionRawMessage) => {
    if (closedIds.has(connection.id)) return
    closedIds.add(connection.id)
    if (closedIds.size > CLOSED_ID_LIMIT) {
      closedIds.delete(closedIds.values().next().value as string)
    }
    pendingClosed.push(connection)
  }

  return {
    apply(message: ConnectionEvents) {
      let traffic = message.reset

      if (message.reset) active = new Map()

      for (const event of message.events) {
        if (event.type === EVENT_NEW && event.connection) {
          const connection = toRawConnection(event.connection)

          if (connection.closedAt > 0) close(connection)
          else active.set(connection.id, connection)
        } else if (event.type === EVENT_UPDATE) {
          const current = active.get(event.id)

          traffic = true
          if (current) {
            active.set(event.id, {
              ...current,
              uplinkTotal: current.uplinkTotal + Number(event.uplinkDelta),
              downlinkTotal: current.downlinkTotal + Number(event.downlinkDelta),
            })
          }
        } else if (event.type === EVENT_CLOSED) {
          const current =
            active.get(event.id) ??
            (event.connection ? toRawConnection(event.connection) : undefined)

          active.delete(event.id)
          if (current) close({ ...current, closedAt: Number(event.closedAt) || current.closedAt })
        }
      }

      return traffic
    },
    drain(): ConnectionsPayload {
      const closed = pendingClosed

      pendingClosed = []
      return { connections: [...active.values()], closed }
    },
    active: () => [...active.values()],
  }
}

export const splitHostPort = (address: string): [string, string] => {
  const bracketed = /^\[(.*)\]:(\d+)$/.exec(address)

  if (bracketed) return [bracketed[1], bracketed[2]]

  const index = address.lastIndexOf(':')

  if (index === -1 || address.indexOf(':') !== index) return [address, '']
  return [address.slice(0, index), address.slice(index + 1)]
}

const joinHostPort = (host: string, port: string) => {
  if (!port) return host
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}

const asSingbox = (connection: Connection) => connection as SingboxConnectionRawMessage & Connection

const hostOf = (connection: SingboxConnectionRawMessage) =>
  connection.domain || splitHostPort(connection.destination)[0]

export const singboxConnectionAccessor: ConnectionAccessor = {
  chains: (connection) => asSingbox(connection).chainList,
  download: (connection) => asSingbox(connection).downlinkTotal,
  upload: (connection) => asSingbox(connection).uplinkTotal,
  start: (connection) => asSingbox(connection).createdAt,
  rule: (connection) => asSingbox(connection).rule || 'final',
  rulePayload: () => '',
  sourceIP: (connection) => splitHostPort(asSingbox(connection).source)[0],
  sourcePort: (connection) => splitHostPort(asSingbox(connection).source)[1],
  network: (connection) => asSingbox(connection).network,
  networkType: (connection) => {
    const singbox = asSingbox(connection)
    const inbound = singbox.inbound ? `${singbox.inboundType}/${singbox.inbound}` : singbox.inboundType

    return `${inbound} | ${singbox.network}`
  },
  hostname: (connection) => hostOf(asSingbox(connection)),
  host: (connection) => {
    const singbox = asSingbox(connection)

    return joinHostPort(hostOf(singbox), splitHostPort(singbox.destination)[1])
  },
  process: (connection) => {
    const singbox = asSingbox(connection)

    return singbox.processPath.replace(/^.*[/\\]/, '') || singbox.packageNames[0] || '-'
  },
  destination: (connection) => splitHostPort(asSingbox(connection).destination)[0],
  inboundUser: (connection) => asSingbox(connection).user || '-',
  sniffHost: () => '',
  remoteAddress: () => '',
  isDirect: (connection) => asSingbox(connection).outboundType === 'direct',
  smartBlock: () => undefined,
}
```

- [ ] **Step 5: driver 接入 connections**

`src/assembly/driver/singbox-api.ts`：imports 追加

```ts
import {
  createConnectionAccumulator,
  singboxConnectionAccessor,
  splitHostPort,
} from '@/assembly/singbox/connection-events'
import type { SingboxConnectionRawMessage } from '@/types'
import type { ConnectionsPayload } from './types'
```

（`ConnectionsPayload` 并入已有的 `import type { Driver, Stream } from './types'`。）

在 `singboxApiDriver` 之前加：

```ts
const CONNECTIONS_IDLE_EMIT = 1500

let lastActive: SingboxConnectionRawMessage[] = []

const subscribeConnections = (): Stream<ConnectionsPayload> => {
  const data = shallowRef<ConnectionsPayload>()
  const accumulator = createConnectionAccumulator()
  let timer: ReturnType<typeof setTimeout> | undefined
  let received = false

  const emit = () => {
    clearTimeout(timer)
    const payload = accumulator.drain()

    lastActive = payload.connections as SingboxConnectionRawMessage[]
    data.value = payload
    timer = setTimeout(emit, CONNECTIONS_IDLE_EMIT)
  }

  const off = runtime().connectionsStream.subscribe((message) => {
    const traffic = accumulator.apply(message)

    if (!received || traffic) {
      received = true
      emit()
    }
  })

  return {
    data,
    close: () => {
      off()
      clearTimeout(timer)
      lastActive = []
    },
  }
}
```

`singboxApiDriver` 里加 `connections`：

```ts
  connections: {
    ...singboxDriver.connections,
    accessor: singboxConnectionAccessor,
    subscribe: subscribeConnections,
    disconnect: async (id) => {
      await runtime().api().closeConnection({ id })
    },
    disconnectAll: async (filter) => {
      if (!filter) {
        await runtime().api().closeAllConnections({})
        return
      }

      const targets = lastActive.filter(
        (connection) =>
          (!filter.type || connection.network === filter.type) &&
          (!filter.src || splitHostPort(connection.source)[0] === filter.src),
      )

      await Promise.all(targets.map(({ id }) => runtime().api().closeConnection({ id })))
    },
  },
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm -C fork-test exec vitest run singbox/api/connections.test.ts`
Expected: PASS。

- [ ] **Step 7: 全量检查并提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test
git add src/types/singbox.d.ts src/types/index.d.ts src/assembly/singbox/connection-events.ts src/assembly/driver/singbox-api.ts fork-test/singbox/api/connections.test.ts
git commit -m "feat(singbox): stream connections from sing-box API with incremental events"
```

---

### Task 8: ANSI 解析与渲染组件

**Files:**
- Create: `src/assembly/singbox/ansi.ts`, `src/components/singbox/AnsiText.vue`
- Test: `fork-test/singbox/api/ansi.test.ts`

**Interfaces:**
- Produces:
  - `type AnsiStyle = { fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean }`（16 色记为 `'ansi-0'`…`'ansi-15'`，256 色与真彩色记为 `'#rrggbb'`）
  - `type AnsiSegment = AnsiStyle & { text: string }`，`type HighlightedSegment = AnsiSegment & { matched: boolean }`
  - `parseAnsi(input: string): AnsiSegment[]`、`stripAnsi(segments): string`、`sliceSegments(segments, start: number): AnsiSegment[]`、`mapAnsiText(segments, map: (text: string) => string): AnsiSegment[]`、`matchedRanges(parts: { text: string; matched: boolean }[]): [number, number][]`、`highlightSegments(segments, ranges): HighlightedSegment[]`
  - 组件 `AnsiText.vue`，props `{ segments: AnsiSegment[]; text: string; filter: string }`；`stripAnsi(segments) !== text` 时退化为纯文本渲染。

- [ ] **Step 1: 写失败的测试**

`fork-test/singbox/api/ansi.test.ts`：

```ts
import {
  highlightSegments,
  mapAnsiText,
  matchedRanges,
  parseAnsi,
  sliceSegments,
  stripAnsi,
} from '@/assembly/singbox/ansi'
import { describe, expect, it } from 'vitest'

const ESC = String.fromCharCode(27)
const sgr = (codes: string) => `${ESC}[${codes}m`

describe('parseAnsi', () => {
  it('returns one plain segment without escapes', () => {
    expect(parseAnsi('hello')).toEqual([{ text: 'hello' }])
  })

  it('parses basic, bright and reset', () => {
    expect(parseAnsi(`${sgr('31')}ERROR${sgr('0')} ${sgr('1;94')}x`)).toEqual([
      { text: 'ERROR', fg: 'ansi-1' },
      { text: ' ' },
      { text: 'x', fg: 'ansi-12', bold: true },
    ])
  })

  it('parses 256 colors and true color', () => {
    expect(parseAnsi(`${sgr('38;5;196')}a${sgr('38;5;9')}b${sgr('38;5;244')}c${sgr('48;2;1;2;255')}d`)).toEqual([
      { text: 'a', fg: '#ff0000' },
      { text: 'b', fg: 'ansi-9' },
      { text: 'c', fg: '#808080' },
      { text: 'd', fg: '#808080', bg: '#0102ff' },
    ])
  })

  it('handles attribute resets, empty params and unknown sequences', () => {
    expect(parseAnsi(`${sgr('1;3;4')}a${sgr('22;23;24')}b${sgr('')}c${ESC}[2Kd${sgr('5')}e${sgr('39;49')}f`)).toEqual([
      { text: 'a', bold: true, italic: true, underline: true },
      { text: 'b' },
      { text: 'c' },
      { text: 'd' },
      { text: 'e' },
      { text: 'f' },
    ])
  })
})

describe('segment helpers', () => {
  const segments = parseAnsi(`${sgr('36')}INFO[0012]${sgr('0')} [${sgr('38;5;208')}123 5ms${sgr('0')}] dns: ok`)

  it('strips and slices', () => {
    expect(stripAnsi(segments)).toBe('INFO[0012] [123 5ms] dns: ok')
    expect(stripAnsi(sliceSegments(segments, 11))).toBe('[123 5ms] dns: ok')
    expect(sliceSegments(segments, 11)[0]).toEqual({ text: '[' })
    expect(sliceSegments(segments, 12)[0]).toEqual({ text: '123 5ms', fg: '#ff8700' })
  })

  it('maps text per segment', () => {
    const mapped = mapAnsiText(parseAnsi(`${sgr('31')}1.2.3.4:${sgr('0')} x`), (text) =>
      text.replace('1.2.3.4:', '1.2.3.4 (home) :'),
    )

    expect(stripAnsi(mapped)).toBe('1.2.3.4 (home) : x')
    expect(mapped[0].fg).toBe('ansi-1')
  })

  it('highlights ranges across segment boundaries', () => {
    const parts = [
      { text: 'INFO[00', matched: false },
      { text: '12] [1', matched: true },
      { text: '23 5ms] dns: ok', matched: false },
    ]
    const ranges = matchedRanges(parts)
    const result = highlightSegments(segments, ranges)

    expect(ranges).toEqual([[7, 13]])
    expect(result.map((part) => part.text).join('')).toBe(stripAnsi(segments))
    expect(result.filter((part) => part.matched).map((part) => part.text)).toEqual(['12]', ' [', '1'])
    expect(result.find((part) => part.text === '12]')?.fg).toBe('ansi-6')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm -C fork-test exec vitest run singbox/api/ansi.test.ts`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现 ansi.ts**

```ts
export type AnsiStyle = {
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

export type AnsiSegment = AnsiStyle & { text: string }

export type HighlightedSegment = AnsiSegment & { matched: boolean }

const ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[([0-9;]*)([A-Za-z])`, 'g')
const CUBE = [0, 95, 135, 175, 215, 255]

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')).join('')}`

const palette256 = (index: number) => {
  if (index < 16) return `ansi-${index}`
  if (index < 232) {
    const value = index - 16

    return hex(CUBE[Math.floor(value / 36)], CUBE[Math.floor(value / 6) % 6], CUBE[value % 6])
  }

  const gray = 8 + (index - 232) * 10

  return hex(gray, gray, gray)
}

const extendedColor = (codes: number[], start: number): [string | undefined, number] => {
  if (codes[start] === 5 && codes[start + 1] !== undefined) {
    return [palette256(codes[start + 1]), 2]
  }
  if (codes[start] === 2 && codes[start + 3] !== undefined) {
    return [hex(codes[start + 1], codes[start + 2], codes[start + 3]), 4]
  }
  return [undefined, 0]
}

const applySgr = (current: AnsiStyle, params: string): AnsiStyle => {
  const codes = params === '' ? [0] : params.split(';').map((value) => Number(value || 0))
  let style: AnsiStyle = { ...current }

  for (let index = 0; index < codes.length; index++) {
    const code = codes[index]

    if (code === 0) style = {}
    else if (code === 1) style.bold = true
    else if (code === 2) style.dim = true
    else if (code === 3) style.italic = true
    else if (code === 4) style.underline = true
    else if (code === 22) {
      delete style.bold
      delete style.dim
    } else if (code === 23) delete style.italic
    else if (code === 24) delete style.underline
    else if (code >= 30 && code <= 37) style.fg = `ansi-${code - 30}`
    else if (code >= 90 && code <= 97) style.fg = `ansi-${code - 82}`
    else if (code === 39) delete style.fg
    else if (code >= 40 && code <= 47) style.bg = `ansi-${code - 40}`
    else if (code >= 100 && code <= 107) style.bg = `ansi-${code - 92}`
    else if (code === 49) delete style.bg
    else if (code === 38 || code === 48) {
      const [color, consumed] = extendedColor(codes, index + 1)

      if (color) style[code === 38 ? 'fg' : 'bg'] = color
      index += consumed
    }
  }

  return style
}

export const parseAnsi = (input: string): AnsiSegment[] => {
  const segments: AnsiSegment[] = []
  let style: AnsiStyle = {}
  let last = 0

  const push = (text: string) => {
    if (text) segments.push({ ...style, text })
  }

  for (const match of input.matchAll(ESCAPE)) {
    push(input.slice(last, match.index))
    if (match[2] === 'm') style = applySgr(style, match[1])
    last = match.index + match[0].length
  }

  push(input.slice(last))
  return segments
}

export const stripAnsi = (segments: AnsiSegment[]) =>
  segments.map((segment) => segment.text).join('')

export const sliceSegments = (segments: AnsiSegment[], start: number): AnsiSegment[] => {
  const result: AnsiSegment[] = []
  let offset = 0

  for (const segment of segments) {
    const end = offset + segment.text.length

    if (end > start) {
      result.push({ ...segment, text: segment.text.slice(Math.max(0, start - offset)) })
    }
    offset = end
  }

  return result
}

export const mapAnsiText = (segments: AnsiSegment[], map: (text: string) => string) =>
  segments.map((segment) => ({ ...segment, text: map(segment.text) }))

export const matchedRanges = (parts: { text: string; matched: boolean }[]) => {
  const ranges: [number, number][] = []
  let offset = 0

  for (const part of parts) {
    if (part.matched) ranges.push([offset, offset + part.text.length])
    offset += part.text.length
  }

  return ranges
}

export const highlightSegments = (
  segments: AnsiSegment[],
  ranges: [number, number][],
): HighlightedSegment[] => {
  const result: HighlightedSegment[] = []
  let offset = 0

  for (const segment of segments) {
    const end = offset + segment.text.length
    const cuts = new Set([offset, end])

    for (const [from, to] of ranges) {
      if (from > offset && from < end) cuts.add(from)
      if (to > offset && to < end) cuts.add(to)
    }

    const points = [...cuts].sort((a, b) => a - b)

    for (let index = 0; index < points.length - 1; index++) {
      const from = points[index]
      const to = points[index + 1]

      result.push({
        ...segment,
        text: segment.text.slice(from - offset, to - offset),
        matched: ranges.some(([start, stop]) => from >= start && to <= stop),
      })
    }
    offset = end
  }

  return result
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm -C fork-test exec vitest run singbox/api/ansi.test.ts`
Expected: PASS。

- [ ] **Step 5: 实现 AnsiText.vue**

```vue
<template>
  <template
    v-for="(part, index) in parts"
    :key="index"
  >
    <mark
      v-if="part.matched"
      class="rounded-xs bg-yellow-300 text-black"
    >
      {{ part.text }}
    </mark>
    <span
      v-else
      :class="part.classes"
      :style="part.style"
      >{{ part.text }}</span
    >
  </template>
</template>

<script setup lang="ts">
import {
  highlightSegments,
  matchedRanges,
  stripAnsi,
  type AnsiSegment,
} from '@/assembly/singbox/ansi'
import { getSearchTextParts } from '@/helper/search'
import { computed } from 'vue'

const props = defineProps<{
  segments: AnsiSegment[]
  text: string
  filter: string
}>()

const FG = [
  'text-base-content/60',
  'text-error',
  'text-success',
  'text-warning',
  'text-info',
  'text-secondary',
  'text-accent',
  'text-base-content',
  'text-base-content/80',
  'text-error',
  'text-success',
  'text-warning',
  'text-info',
  'text-secondary',
  'text-accent',
  'text-base-content',
]

const BG = [
  'bg-base-300',
  'bg-error/30',
  'bg-success/30',
  'bg-warning/30',
  'bg-info/30',
  'bg-secondary/30',
  'bg-accent/30',
  'bg-base-200',
  'bg-base-300',
  'bg-error/30',
  'bg-success/30',
  'bg-warning/30',
  'bg-info/30',
  'bg-secondary/30',
  'bg-accent/30',
  'bg-base-200',
]

const paletteIndex = (color?: string) =>
  color?.startsWith('ansi-') ? Number(color.slice(5)) : undefined

const parts = computed(() => {
  const segments =
    stripAnsi(props.segments) === props.text ? props.segments : [{ text: props.text }]
  const ranges = matchedRanges(getSearchTextParts(props.text, props.filter))

  return highlightSegments(segments, ranges).map((segment) => {
    const fg = paletteIndex(segment.fg)
    const bg = paletteIndex(segment.bg)

    return {
      text: segment.text,
      matched: segment.matched,
      classes: [
        fg !== undefined && FG[fg],
        bg !== undefined && BG[bg],
        segment.bold && 'font-bold',
        segment.dim && 'opacity-60',
        segment.italic && 'italic',
        segment.underline && 'underline',
      ],
      style: {
        color: fg === undefined ? segment.fg : undefined,
        backgroundColor: bg === undefined ? segment.bg : undefined,
      },
    }
  })
})
</script>
```

- [ ] **Step 6: 全量检查并提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test
git add src/assembly/singbox/ansi.ts src/components/singbox/AnsiText.vue fork-test/singbox/api/ansi.test.ts
git commit -m "feat(singbox): parse and render ANSI colored log text"
```

---

### Task 9: 日志走 sing-box API

**Files:**
- Create: `src/assembly/singbox/api-logs.ts`
- Modify: `src/types/index.d.ts:156-159`, `src/assembly/driver/singbox-api.ts`, `src/assembly/logs.ts:1-10,72-86`, `src/components/logs/LogsCard.vue:31-36,40-48`, `src/components/logs/LogsTable.vue:95-102` 及其 imports
- Test: `fork-test/singbox/api/api-logs.test.ts`

**Interfaces:**
- Consumes: `parseAnsi`、`stripAnsi`、`sliceSegments`、`mapAnsiText`（Task 8），`logStream`（Task 6），`AnsiText.vue`（Task 8）。
- Produces:
  - `Log` 类型增加 `ansi?: AnsiSegment[]`
  - `toLogLevel(level: number): LOG_LEVEL`、`passesLevel(type: string, selected: string): boolean`、`toLog(message: { level: number; message: string }): Log`、`dedupeBacklog(delivered: string[], backlog: string[]): string[]`、`DELIVERED_LIMIT = 64`

- [ ] **Step 1: 写失败的测试**

`fork-test/singbox/api/api-logs.test.ts`：

```ts
import { singboxApiDriver } from '@/assembly/driver/singbox-api'
import {
  LogLevel,
  LogSchema,
  type Log as PbLog,
} from '@/assembly/singbox/api/gen/daemon/started_service_pb'
import { dedupeBacklog, passesLevel, toLog, toLogLevel } from '@/assembly/singbox/api-logs'
import { LOG_LEVEL } from '@/constant'
import type { Log } from '@/types'
import { create } from '@bufbuild/protobuf'
import { beforeEach, describe, expect, it } from 'vitest'
import { fakeShared, installRuntime } from './fake-runtime'

const ESC = String.fromCharCode(27)

describe('levels', () => {
  it('maps every sing-box level', () => {
    expect(toLogLevel(LogLevel.PANIC)).toBe(LOG_LEVEL.Panic)
    expect(toLogLevel(LogLevel.FATAL)).toBe(LOG_LEVEL.Fatal)
    expect(toLogLevel(LogLevel.ERROR)).toBe(LOG_LEVEL.Error)
    expect(toLogLevel(LogLevel.WARN)).toBe(LOG_LEVEL.Warning)
    expect(toLogLevel(LogLevel.INFO)).toBe(LOG_LEVEL.Info)
    expect(toLogLevel(LogLevel.DEBUG)).toBe(LOG_LEVEL.Debug)
    expect(toLogLevel(LogLevel.TRACE)).toBe(LOG_LEVEL.Trace)
  })

  it('filters by minimum severity', () => {
    expect(passesLevel(LOG_LEVEL.Info, LOG_LEVEL.Info)).toBe(true)
    expect(passesLevel(LOG_LEVEL.Debug, LOG_LEVEL.Info)).toBe(false)
    expect(passesLevel(LOG_LEVEL.Panic, LOG_LEVEL.Warning)).toBe(true)
    expect(passesLevel(LOG_LEVEL.Trace, LOG_LEVEL.Trace)).toBe(true)
    expect(passesLevel(LOG_LEVEL.Error, LOG_LEVEL.Silent)).toBe(false)
  })
})

describe('toLog', () => {
  it('strips the level prefix and keeps colors', () => {
    const log = toLog({
      level: LogLevel.INFO,
      message: `${ESC}[36mINFO${ESC}[0m[0012] [${ESC}[38;5;208m123 5ms${ESC}[0m] dns: ok`,
    })

    expect(log.type).toBe(LOG_LEVEL.Info)
    expect(log.payload).toBe('[123 5ms] dns: ok')
    expect(log.ansi?.map((segment) => segment.text).join('')).toBe(log.payload)
    expect(log.ansi?.some((segment) => segment.fg === '#ff8700')).toBe(true)
  })

  it('leaves messages without prefix untouched', () => {
    expect(toLog({ level: LogLevel.WARN, message: 'plain text' }).payload).toBe('plain text')
  })
})

describe('dedupeBacklog', () => {
  it('returns only lines after the delivered tail', () => {
    expect(dedupeBacklog(['a', 'b', 'c'], ['a', 'b', 'c', 'd', 'e'])).toEqual(['d', 'e'])
    expect(dedupeBacklog(['x', 'b', 'c'], ['b', 'c', 'd'])).toEqual(['d'])
  })

  it('returns everything without an overlap', () => {
    expect(dedupeBacklog(['a'], ['p', 'q'])).toEqual(['p', 'q'])
    expect(dedupeBacklog([], ['p'])).toEqual(['p'])
  })

  it('returns nothing when the backlog is fully delivered', () => {
    expect(dedupeBacklog(['a', 'b'], ['a', 'b'])).toEqual([])
  })
})

describe('singboxApiDriver.logs', () => {
  const stream = fakeShared<PbLog>()
  const message = (level: LogLevel, text: string) => ({ level, message: `INFO[0001] ${text}` })

  beforeEach(() => {
    installRuntime({ logStream: stream })
  })

  it('delivers the backlog once, filters by level and dedupes after reconnect', () => {
    const batches: Log[][] = []
    const subscription = singboxApiDriver.logs.subscribe(LOG_LEVEL.Info, (batch) => batches.push(batch))

    stream.emit(create(LogSchema, { reset: true, messages: [message(LogLevel.INFO, 'a'), message(LogLevel.DEBUG, 'b')] }))
    stream.emit(create(LogSchema, { messages: [message(LogLevel.ERROR, 'c')] }))
    stream.emit(
      create(LogSchema, {
        reset: true,
        messages: [message(LogLevel.INFO, 'a'), message(LogLevel.DEBUG, 'b'), message(LogLevel.ERROR, 'c'), message(LogLevel.INFO, 'd')],
      }),
    )

    expect(batches.map((batch) => batch.map((log) => log.payload))).toEqual([['a'], ['c'], ['d']])

    subscription.close()
    expect(stream.size()).toBe(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm -C fork-test exec vitest run singbox/api/api-logs.test.ts`
Expected: FAIL，找不到 `api-logs` 模块。

- [ ] **Step 3: Log 类型挂接**

`src/types/index.d.ts`：在 imports 区加 `import type { AnsiSegment } from '@/assembly/singbox/ansi'`；`Log` 类型加一个可选字段：

```ts
export type Log = {
  type: LOG_LEVEL
  payload: string
  ansi?: AnsiSegment[]
}
```

（保留 `Log` 原有字段，只加 `ansi?` 一行。）

- [ ] **Step 4: 实现 api-logs.ts**

```ts
import { LOG_LEVEL } from '@/constant'
import type { Log } from '@/types'
import { parseAnsi, sliceSegments, stripAnsi } from './ansi'

export const DELIVERED_LIMIT = 64

const BY_PB_LEVEL = [
  LOG_LEVEL.Panic,
  LOG_LEVEL.Fatal,
  LOG_LEVEL.Error,
  LOG_LEVEL.Warning,
  LOG_LEVEL.Info,
  LOG_LEVEL.Debug,
  LOG_LEVEL.Trace,
]

const SEVERITY: string[] = [
  LOG_LEVEL.Trace,
  LOG_LEVEL.Debug,
  LOG_LEVEL.Info,
  LOG_LEVEL.Warning,
  LOG_LEVEL.Error,
  LOG_LEVEL.Fatal,
  LOG_LEVEL.Panic,
]

const PREFIX = /^[A-Z]+(\[\d+\])? /

export const toLogLevel = (level: number) => BY_PB_LEVEL[level] ?? LOG_LEVEL.Info

export const passesLevel = (type: string, selected: string) => {
  if (selected === LOG_LEVEL.Silent) return false

  const minimum = SEVERITY.indexOf(selected)

  return minimum === -1 || SEVERITY.indexOf(type) >= minimum
}

export const toLog = (message: { level: number; message: string }): Log => {
  const segments = parseAnsi(message.message)
  const plain = stripAnsi(segments)
  const prefix = PREFIX.exec(plain)?.[0].length ?? 0

  return {
    type: toLogLevel(message.level),
    payload: plain.slice(prefix),
    ansi: sliceSegments(segments, prefix),
  }
}

export const dedupeBacklog = (delivered: string[], backlog: string[]) => {
  if (!delivered.length) return backlog

  for (let end = backlog.length; end > 0; end--) {
    const size = Math.min(end, delivered.length)
    let matched = true

    for (let index = 1; index <= size; index++) {
      if (backlog[end - index] !== delivered[delivered.length - index]) {
        matched = false
        break
      }
    }

    if (matched) return backlog.slice(end)
  }

  return backlog
}
```

- [ ] **Step 5: driver 接入 logs**

`src/assembly/driver/singbox-api.ts`：imports 追加

```ts
import { dedupeBacklog, DELIVERED_LIMIT, passesLevel, toLog } from '@/assembly/singbox/api-logs'
```

`singboxApiDriver` 里加：

```ts
  logs: {
    subscribe: (level, onBatch) => {
      let delivered: string[] = []
      let first = true

      const close = runtime().logStream.subscribe((message) => {
        const raw = message.messages.map((item) => item.message)
        const fresh = message.reset && !first ? dedupeBacklog(delivered, raw) : raw
        const start = raw.length - fresh.length
        const logs = message.messages
          .slice(start)
          .map(toLog)
          .filter((log) => passesLevel(log.type, level))

        first = false
        delivered = delivered.concat(fresh).slice(-DELIVERED_LIMIT)
        if (logs.length) onBatch(logs)
      })

      return { close }
    },
  },
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm -C fork-test exec vitest run singbox/api/api-logs.test.ts`
Expected: PASS。

- [ ] **Step 7: 门面与视图挂接**

`src/assembly/logs.ts`：imports 加 `import { mapAnsiText } from './singbox/ansi'`；在批处理循环里，把 `pending.unshift({ ...data, payload, ... })` 改为在 `payload` 之后多一个 `ansi` 字段：

```ts
      pending.unshift({
        ...data,
        payload,
        ansi:
          data.ansi &&
          mapAnsiText(data.ansi, (text) =>
            matchers.reduce((value, [regex, label]) => value.replace(regex, label), text),
          ),
        time: dayjs().format('HH:mm:ss'),
        seq: seq++,
      })
```

`src/components/logs/LogsCard.vue`：把正文的

```vue
      <HighlightText
        :text="log.payload"
        :filter="logFilter"
      />
```

改为

```vue
      <AnsiText
        v-if="log.ansi"
        :segments="log.ansi"
        :text="log.payload"
        :filter="logFilter"
      />
      <HighlightText
        v-else
        :text="log.payload"
        :filter="logFilter"
      />
```

并在 imports 加 `import AnsiText from '@/components/singbox/AnsiText.vue'`。

`src/components/logs/LogsTable.vue`：`payload` 列的 `cell` 改为

```ts
    cell: ({ row }) =>
      row.original.ansi
        ? h(AnsiText, {
            segments: row.original.ansi,
            text: row.original.payload,
            filter: logFilter.value,
          })
        : h(HighlightText, { text: row.original.payload, filter: logFilter.value }),
```

并在 imports 加 `import AnsiText from '@/components/singbox/AnsiText.vue'`。

- [ ] **Step 8: 全量检查并提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test && pnpm build
git add src/assembly/singbox/api-logs.ts src/types/index.d.ts src/assembly/driver/singbox-api.ts src/assembly/logs.ts src/components/logs/LogsCard.vue src/components/logs/LogsTable.vue fork-test/singbox/api/api-logs.test.ts
git commit -m "feat(singbox): stream colored logs from sing-box API"
```

---

### Task 10: Groups / ClashMode 变化通知

**Files:**
- Create: `src/assembly/singbox/events.ts`, `src/assembly/singbox/refresh.ts`
- Modify: `src/assembly/driver/singbox-api.ts`, `src/assembly/session.ts:1-12,42-44`
- Test: `fork-test/singbox/api/events.test.ts`

**Interfaces:**
- Consumes: `groupsStream`、`clashModeStream`（Task 6）。
- Produces:
  - `groupsSignature(groups: Groups): string`、`createChangeDetector<T>(signature: (value: T) => string): (value: T) => boolean`（首个值返回 false，之后签名变化才返回 true）
  - `refresh.ts`：`handleSingboxEvent(kind: string): void`（`'proxies.changed'` → 防抖 400ms `fetchProxies`；`'configs.changed'` → 防抖 400ms `fetchConfigs`）、`cancelSingboxRefresh(): void`
  - driver `events.subscribe` 发出 `'proxies.changed'` / `'configs.changed'`

- [ ] **Step 1: 写失败的测试**

`fork-test/singbox/api/events.test.ts`：

```ts
import { singboxApiDriver } from '@/assembly/driver/singbox-api'
import {
  ClashModeSchema,
  GroupsSchema,
  type ClashMode,
  type Groups,
} from '@/assembly/singbox/api/gen/daemon/started_service_pb'
import { createChangeDetector, groupsSignature } from '@/assembly/singbox/events'
import { create } from '@bufbuild/protobuf'
import { beforeEach, describe, expect, it } from 'vitest'
import { fakeShared, installRuntime } from './fake-runtime'

const groups = (selected: string, delay = 100) =>
  create(GroupsSchema, {
    group: [
      {
        tag: 'proxy',
        type: 'selector',
        selected,
        items: [{ tag: 'a', urlTestTime: 1n, urlTestDelay: delay }],
      },
    ],
  })

describe('change detection', () => {
  it('ignores the first value and repeats', () => {
    const changed = createChangeDetector((value: string) => value)

    expect(changed('a')).toBe(false)
    expect(changed('a')).toBe(false)
    expect(changed('b')).toBe(true)
  })

  it('signs selection and url test results', () => {
    expect(groupsSignature(groups('a'))).not.toBe(groupsSignature(groups('b')))
    expect(groupsSignature(groups('a', 100))).not.toBe(groupsSignature(groups('a', 200)))
    expect(groupsSignature(groups('a'))).toBe(groupsSignature(groups('a')))
  })
})

describe('singboxApiDriver.events', () => {
  const groupsStream = fakeShared<Groups>()
  const clashModeStream = fakeShared<ClashMode>()

  beforeEach(() => {
    installRuntime({ groupsStream, clashModeStream })
  })

  it('emits proxies.changed and configs.changed on real changes only', () => {
    const kinds: string[] = []
    const subscription = singboxApiDriver.events!.subscribe((kind) => kinds.push(kind))

    groupsStream.emit(groups('a'))
    clashModeStream.emit(create(ClashModeSchema, { mode: 'Rule' }))
    groupsStream.emit(groups('a'))
    clashModeStream.emit(create(ClashModeSchema, { mode: 'rule' }))
    expect(kinds).toEqual([])

    groupsStream.emit(groups('b'))
    clashModeStream.emit(create(ClashModeSchema, { mode: 'Global' }))
    expect(kinds).toEqual(['proxies.changed', 'configs.changed'])

    subscription.close()
    expect(groupsStream.size()).toBe(0)
    expect(clashModeStream.size()).toBe(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm -C fork-test exec vitest run singbox/api/events.test.ts`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现 events.ts 与 refresh.ts**

`src/assembly/singbox/events.ts`（纯函数，被 driver 引用，不能反向引用 proxies / config，否则形成 driver → proxies → driver 的循环）：

```ts
import type { Groups } from './api/gen/daemon/started_service_pb'

export const groupsSignature = (groups: Groups) =>
  groups.group
    .map(
      (group) =>
        `${group.tag}=${group.selected}[${group.items
          .map((item) => `${item.tag}/${item.urlTestTime}/${item.urlTestDelay}`)
          .join(',')}]`,
    )
    .join(';')

export const createChangeDetector = <T>(signature: (value: T) => string) => {
  let last: string | undefined

  return (value: T) => {
    const next = signature(value)
    const changed = last !== undefined && last !== next

    last = next
    return changed
  }
}
```

`src/assembly/singbox/refresh.ts`（只被 session 引用）：

```ts
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
```

- [ ] **Step 4: driver 接入 events**

`src/assembly/driver/singbox-api.ts`：imports 追加

```ts
import type { ClashMode } from '@/assembly/singbox/api/gen/daemon/started_service_pb'
import { createChangeDetector, groupsSignature } from '@/assembly/singbox/events'
```

`singboxApiDriver` 里加：

```ts
  events: {
    subscribe: (onEvent) => {
      const groupsChanged = createChangeDetector(groupsSignature)
      const modeChanged = createChangeDetector((mode: ClashMode) => mode.mode.toLowerCase())
      const offGroups = runtime().groupsStream.subscribe((groups) => {
        if (groupsChanged(groups)) onEvent('proxies.changed', undefined)
      })
      const offMode = runtime().clashModeStream.subscribe((mode) => {
        if (modeChanged(mode)) onEvent('configs.changed', undefined)
      })

      return {
        close: () => {
          offGroups()
          offMode()
        },
      }
    },
  },
```

- [ ] **Step 5: session 挂接**

`src/assembly/session.ts`：imports 加 `import { cancelSingboxRefresh, handleSingboxEvent } from './singbox/refresh'`；`stopEvents` 里 `clearTimeout(refreshTimer)` 之后加一行 `cancelSingboxRefresh()`；`initEvents` 的回调改为：

```ts
  events = subscribe((kind) => {
    if (kind === 'generation.changed') scheduleRefresh()
    else handleSingboxEvent(kind)
  })
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm -C fork-test exec vitest run singbox/api/events.test.ts`
Expected: PASS。

- [ ] **Step 7: 全量检查并提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test
git add src/assembly/singbox/events.ts src/assembly/singbox/refresh.ts src/assembly/driver/singbox-api.ts src/assembly/session.ts fork-test/singbox/api/events.test.ts
git commit -m "feat(singbox): refresh proxies and configs on sing-box API change events"
```

---
### Task 11: 概览页 sing-box 状态卡

**Files:**
- Create: `src/components/singbox/SingboxStatsCard.vue`
- Modify: `src/assembly/singbox/status.ts`, `src/constant/index.ts:404-413`, `src/views/OverviewPage.vue:21,47`, `src/components/overview/OverviewCardSettingsDialog.vue:51`, `src/i18n/singbox/*.ts`
- Test: `fork-test/singbox/api/status.test.ts`（追加）

**Interfaces:**
- Consumes: `singboxRuntime`（Task 4/6）。
- Produces: `formatUptime(ms: number): string`；`OVERVIEW_CARD.SingboxStatsCard = 'SingboxStatsCard'`。

- [ ] **Step 1: 追加失败的测试**

在 `fork-test/singbox/api/status.test.ts` 的 import 里加 `formatUptime`，文件末尾追加：

```ts
describe('formatUptime', () => {
  it('formats short and long durations', () => {
    expect(formatUptime(0)).toBe('00:00:00')
    expect(formatUptime(3_723_000)).toBe('01:02:03')
    expect(formatUptime(90_061_000)).toBe('1d 1h 1m')
    expect(formatUptime(-5)).toBe('00:00:00')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm -C fork-test exec vitest run singbox/api/status.test.ts`
Expected: FAIL，`formatUptime` 未导出。

- [ ] **Step 3: 实现 formatUptime**

`src/assembly/singbox/status.ts` 末尾追加：

```ts
const pad = (value: number) => String(value).padStart(2, '0')

export const formatUptime = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60

  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm -C fork-test exec vitest run singbox/api/status.test.ts`
Expected: PASS。

- [ ] **Step 5: 卡片组件与注册**

`src/components/singbox/SingboxStatsCard.vue`：

```vue
<template>
  <div
    v-if="isVisible"
    class="base-container w-full backdrop-blur-none!"
  >
    <div class="surface flex items-center justify-between p-4">
      <div
        class="text-base-content/60 flex items-center gap-2 text-xs font-semibold tracking-wider uppercase"
      >
        {{ t('singboxStatsCard') }}
      </div>
    </div>
    <div class="surface grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-4">
      <div
        v-for="item in items"
        :key="item.label"
        class="bg-base-200/30 flex flex-col gap-1.5 rounded-xl p-4"
      >
        <div class="text-base-content/60 text-xs font-semibold tracking-wider uppercase">
          {{ item.label }}
        </div>
        <div class="text-2xl font-extralight tabular-nums">{{ item.value }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { can } from '@/assembly/backend'
import { singboxRuntime } from '@/assembly/singbox/api/state'
import { formatUptime } from '@/assembly/singbox/status'
import { useNow } from '@vueuse/core'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const now = useNow({ interval: 1000 })

const isVisible = computed(() => can('singboxApi') && !!singboxRuntime.value)

const items = computed(() => {
  const runtime = singboxRuntime.value

  if (!runtime) return []

  return [
    {
      label: t('singboxUptime'),
      value: runtime.startedAt ? formatUptime(now.value.getTime() - runtime.startedAt) : '-',
    },
    { label: t('singboxGoroutines'), value: String(runtime.goroutines) },
    { label: t('singboxConnectionsIn'), value: String(runtime.connectionsIn) },
    { label: t('singboxConnectionsOut'), value: String(runtime.connectionsOut) },
  ]
})
</script>
```

注册（上游挂接点）：

- `src/constant/index.ts`：`OVERVIEW_CARD` 末尾加 `SingboxStatsCard = 'SingboxStatsCard',`。`store/settings.ts` 已有“缺失卡片自动追加”的逻辑，不用改默认顺序。
- `src/views/OverviewPage.vue`：imports 加 `import SingboxStatsCard from '@/components/singbox/SingboxStatsCard.vue'`；`cardComponents` 末尾加 `SingboxStatsCard,`。
- `src/components/overview/OverviewCardSettingsDialog.vue`：`cardKeyToLabelMap` 末尾加 `SingboxStatsCard: 'singboxStatsCard',`。

- [ ] **Step 6: 文案**

四个 fork i18n 文件各追加：

| key | en | zh | zh-tw | ru |
|---|---|---|---|---|
| `singboxStatsCard` | `sing-box runtime` | `sing-box 运行状态` | `sing-box 執行狀態` | `Состояние sing-box` |
| `singboxUptime` | `Uptime` | `运行时长` | `執行時長` | `Время работы` |
| `singboxGoroutines` | `Goroutines` | `Goroutines` | `Goroutines` | `Горутины` |
| `singboxConnectionsIn` | `Inbound connections` | `入站连接` | `入站連接` | `Входящие подключения` |
| `singboxConnectionsOut` | `Outbound connections` | `出站连接` | `出站連接` | `Исходящие подключения` |

（写成对象属性，如 `singboxUptime: 'Uptime',`。）

- [ ] **Step 7: 全量检查并提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test && pnpm build
git add src/assembly/singbox/status.ts src/components/singbox/SingboxStatsCard.vue src/constant/index.ts src/views/OverviewPage.vue src/components/overview/OverviewCardSettingsDialog.vue src/i18n/singbox fork-test/singbox/api/status.test.ts
git commit -m "feat(singbox): add sing-box runtime card to overview"
```

---

### Task 12: 连接表新列与 SniffHost 门控

**Files:**
- Create: `src/assembly/singbox/connection-keys.ts`
- Modify: `src/constant/index.ts:37-58,64-79`, `src/assembly/driver/types.ts:73-93`, `src/assembly/singbox/connection-events.ts`, `src/assembly/connections.ts:190-194`, `src/components/connections/ConnectionTable.vue`（columnDefinitions、columnVisibility）, `src/components/connections/ConnectionCard.tsx`（componentMap、行过滤）, `src/components/connections/ConnectionDetails.vue:301-322`, `src/components/controls/ConnectionCtrl.tsx:159`, `src/components/settings/connections/TableSettings.vue:89-93`, `src/components/settings/connections/ConnectionCardSettings.vue:116-120`, `src/i18n/singbox/*.ts`
- Test: `fork-test/singbox/api/connection-keys.test.ts`

**Interfaces:**
- Consumes: `singboxConnectionAccessor`（Task 7），`can('singboxApi')`（Task 4）。
- Produces:
  - `CONNECTIONS_TABLE_ACCESSOR_KEY.Protocol = 'protocol'`、`.Inbound = 'inbound'`、`.FromOutbound = 'fromOutbound'`、`.OutboundType = 'outboundType'`
  - `ConnectionAccessor` 可选方法 `protocol?`、`inbound?`、`fromOutbound?`、`outboundType?`（`(connection: Connection) => string`）
  - `isConnectionKeyAvailable(key: CONNECTIONS_TABLE_ACCESSOR_KEY): boolean`

- [ ] **Step 1: 写失败的测试**

`fork-test/singbox/api/connection-keys.test.ts`：

```ts
import { core, Core, resetCore } from '@/assembly/backend'
import { getConnectionDisplayValue } from '@/assembly/connections'
import { singboxApi } from '@/assembly/singbox/api/state'
import { isConnectionKeyAvailable } from '@/assembly/singbox/connection-keys'
import { singboxVariant } from '@/assembly/singbox/variant'
import { CONNECTIONS_TABLE_ACCESSOR_KEY as KEY, PROXY_CHAIN_DIRECTION } from '@/constant'
import { backendList, setActiveBackend } from '@/store/setup'
import type { Connection, SingboxConnectionRawMessage } from '@/types'
import { beforeEach, describe, expect, it } from 'vitest'

const backend = {
  type: 'clash' as const,
  protocol: 'http',
  host: '127.0.0.1',
  port: '9090',
  secondaryPath: '',
  password: '',
  uuid: 'keys',
}

const connection = {
  id: 'x',
  inbound: 'tun-in',
  inboundType: 'tun',
  ipVersion: 4,
  network: 'udp',
  source: '172.19.0.1:5000',
  destination: '1.1.1.1:443',
  domain: 'example.com',
  protocol: 'quic',
  user: '',
  fromOutbound: 'dns-out',
  createdAt: 0,
  closedAt: 0,
  uplinkTotal: 0,
  downlinkTotal: 0,
  rule: '',
  outbound: 'proxy',
  outboundType: 'vless',
  chainList: ['proxy'],
  processPath: '',
  packageNames: [],
  downloadSpeed: 0,
  uploadSpeed: 0,
} as SingboxConnectionRawMessage & Connection

const options = {
  mode: 'table' as const,
  proxyChainDirection: PROXY_CHAIN_DIRECTION.NORMAL,
  showFullProxyChain: true,
}

beforeEach(() => {
  backendList.value = [backend]
  setActiveBackend(backend.uuid)
  resetCore()
})

describe('isConnectionKeyAvailable', () => {
  it('hides sing-box columns and keeps SniffHost without the API', () => {
    core.value = Core.Singbox
    singboxVariant.value = 'refind'

    expect(isConnectionKeyAvailable(KEY.Protocol)).toBe(false)
    expect(isConnectionKeyAvailable(KEY.OutboundType)).toBe(false)
    expect(isConnectionKeyAvailable(KEY.SniffHost)).toBe(true)
    expect(isConnectionKeyAvailable(KEY.Host)).toBe(true)
  })

  it('shows sing-box columns and hides SniffHost with the API', () => {
    core.value = Core.Singbox
    singboxVariant.value = 'moonfruit'
    singboxApi.value = { version: 'x', apiVersion: 5 }

    expect(isConnectionKeyAvailable(KEY.Protocol)).toBe(true)
    expect(isConnectionKeyAvailable(KEY.Inbound)).toBe(true)
    expect(isConnectionKeyAvailable(KEY.FromOutbound)).toBe(true)
    expect(isConnectionKeyAvailable(KEY.OutboundType)).toBe(true)
    expect(isConnectionKeyAvailable(KEY.SniffHost)).toBe(false)
  })
})

describe('display values', () => {
  it('reads the new columns through the sing-box accessor', () => {
    core.value = Core.Singbox
    singboxVariant.value = 'moonfruit'
    singboxApi.value = { version: 'x', apiVersion: 5 }

    expect(getConnectionDisplayValue(connection, KEY.Protocol, options)).toBe('quic')
    expect(getConnectionDisplayValue(connection, KEY.Inbound, options)).toBe('tun-in')
    expect(getConnectionDisplayValue(connection, KEY.FromOutbound, options)).toBe('dns-out')
    expect(getConnectionDisplayValue(connection, KEY.OutboundType, options)).toBe('vless')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm -C fork-test exec vitest run singbox/api/connection-keys.test.ts`
Expected: FAIL，`KEY.Protocol` 不存在 / 模块不存在。

- [ ] **Step 3: 枚举、accessor 接口与实现**

`src/constant/index.ts`：`CONNECTIONS_TABLE_ACCESSOR_KEY` 在 `InboundUser = 'inboundUser',` 之后加

```ts
  Protocol = 'protocol',
  Inbound = 'inbound',
  FromOutbound = 'fromOutbound',
  OutboundType = 'outboundType',
```

`CONNECTION_GROUPABLE_KEYS` 在 `CONNECTIONS_TABLE_ACCESSOR_KEY.InboundUser,` 之后加

```ts
  CONNECTIONS_TABLE_ACCESSOR_KEY.Protocol,
  CONNECTIONS_TABLE_ACCESSOR_KEY.Inbound,
  CONNECTIONS_TABLE_ACCESSOR_KEY.OutboundType,
```

`src/assembly/driver/types.ts`：`ConnectionAccessor` 在 `smartBlock(...)` 之后加

```ts
  protocol?(connection: Connection): string
  inbound?(connection: Connection): string
  fromOutbound?(connection: Connection): string
  outboundType?(connection: Connection): string
```

`src/assembly/singbox/connection-events.ts`：`singboxConnectionAccessor` 末尾（`smartBlock` 之后）加

```ts
  protocol: (connection) => asSingbox(connection).protocol,
  inbound: (connection) => asSingbox(connection).inbound,
  fromOutbound: (connection) => asSingbox(connection).fromOutbound,
  outboundType: (connection) => asSingbox(connection).outboundType,
```

`src/assembly/connections.ts` 的 `getConnectionDisplayValue`：在 `case CONNECTIONS_TABLE_ACCESSOR_KEY.InboundUser:` 分支之后加

```ts
    case CONNECTIONS_TABLE_ACCESSOR_KEY.Protocol:
      return accessor.protocol?.(connection) || '-'
    case CONNECTIONS_TABLE_ACCESSOR_KEY.Inbound:
      return accessor.inbound?.(connection) || '-'
    case CONNECTIONS_TABLE_ACCESSOR_KEY.FromOutbound:
      return accessor.fromOutbound?.(connection) || '-'
    case CONNECTIONS_TABLE_ACCESSOR_KEY.OutboundType:
      return accessor.outboundType?.(connection) || '-'
```

- [ ] **Step 4: 可用性门控**

`src/assembly/singbox/connection-keys.ts`：

```ts
import { can } from '@/assembly/backend'
import { CONNECTIONS_TABLE_ACCESSOR_KEY } from '@/constant'

const SINGBOX_API_KEYS = new Set<CONNECTIONS_TABLE_ACCESSOR_KEY>([
  CONNECTIONS_TABLE_ACCESSOR_KEY.Protocol,
  CONNECTIONS_TABLE_ACCESSOR_KEY.Inbound,
  CONNECTIONS_TABLE_ACCESSOR_KEY.FromOutbound,
  CONNECTIONS_TABLE_ACCESSOR_KEY.OutboundType,
])

export const isConnectionKeyAvailable = (key: CONNECTIONS_TABLE_ACCESSOR_KEY) => {
  if (SINGBOX_API_KEYS.has(key)) return can('singboxApi')
  if (key === CONNECTIONS_TABLE_ACCESSOR_KEY.SniffHost) return !can('singboxApi')
  return true
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm -C fork-test exec vitest run singbox/api/connection-keys.test.ts`
Expected: PASS。

- [ ] **Step 6: 视图挂接**

每处 import `import { isConnectionKeyAvailable } from '@/assembly/singbox/connection-keys'`。

1. `src/components/connections/ConnectionTable.vue`
   - `columnDefinitions` 数组末尾（`InboundUser` 列之后）加四列：

```ts
  {
    header: () => t(CONNECTIONS_TABLE_ACCESSOR_KEY.Protocol),
    id: CONNECTIONS_TABLE_ACCESSOR_KEY.Protocol,
    accessorFn: (original) =>
      getTableDisplayValue(original, CONNECTIONS_TABLE_ACCESSOR_KEY.Protocol),
    cell: highlightedCell(CONNECTIONS_TABLE_ACCESSOR_KEY.Protocol),
  },
  {
    header: () => t(CONNECTIONS_TABLE_ACCESSOR_KEY.Inbound),
    id: CONNECTIONS_TABLE_ACCESSOR_KEY.Inbound,
    accessorFn: (original) =>
      getTableDisplayValue(original, CONNECTIONS_TABLE_ACCESSOR_KEY.Inbound),
    cell: highlightedCell(CONNECTIONS_TABLE_ACCESSOR_KEY.Inbound),
  },
  {
    header: () => t(CONNECTIONS_TABLE_ACCESSOR_KEY.FromOutbound),
    id: CONNECTIONS_TABLE_ACCESSOR_KEY.FromOutbound,
    accessorFn: (original) =>
      getTableDisplayValue(original, CONNECTIONS_TABLE_ACCESSOR_KEY.FromOutbound),
    cell: highlightedCell(CONNECTIONS_TABLE_ACCESSOR_KEY.FromOutbound),
  },
  {
    header: () => t(CONNECTIONS_TABLE_ACCESSOR_KEY.OutboundType),
    id: CONNECTIONS_TABLE_ACCESSOR_KEY.OutboundType,
    accessorFn: (original) =>
      getTableDisplayValue(original, CONNECTIONS_TABLE_ACCESSOR_KEY.OutboundType),
    cell: highlightedCell(CONNECTIONS_TABLE_ACCESSOR_KEY.OutboundType),
  },
```

   - `columnVisibility` getter 里，在已有的 `.filter((key) => key !== CONNECTIONS_TABLE_ACCESSOR_KEY.Close || ...)` 之后、`.map((key) => [key, true])` 之前插入 `.filter(isConnectionKeyAvailable)`。

2. `src/components/connections/ConnectionCard.tsx`
   - `componentMap` 在 `InboundUser` 条目之后加四项，写法与 `InboundUser` 相同：

```tsx
        [CONNECTIONS_TABLE_ACCESSOR_KEY.Protocol]: () => (
          <div class="whitespace-nowrap">
            {highlightedText(CONNECTIONS_TABLE_ACCESSOR_KEY.Protocol)}
          </div>
        ),
        [CONNECTIONS_TABLE_ACCESSOR_KEY.Inbound]: () => (
          <div class="whitespace-nowrap">
            {highlightedText(CONNECTIONS_TABLE_ACCESSOR_KEY.Inbound)}
          </div>
        ),
        [CONNECTIONS_TABLE_ACCESSOR_KEY.FromOutbound]: () => (
          <div class="whitespace-nowrap">
            {highlightedText(CONNECTIONS_TABLE_ACCESSOR_KEY.FromOutbound)}
          </div>
        ),
        [CONNECTIONS_TABLE_ACCESSOR_KEY.OutboundType]: () => (
          <div class="whitespace-nowrap">
            {highlightedText(CONNECTIONS_TABLE_ACCESSOR_KEY.OutboundType)}
          </div>
        ),
```

   - 每行渲染处的过滤改为：

```tsx
                .filter(
                  (key) =>
                    (key !== CONNECTIONS_TABLE_ACCESSOR_KEY.Close || !isClosed) &&
                    isConnectionKeyAvailable(key),
                )
```

3. `src/components/connections/ConnectionDetails.vue` 的 `sectionDefs`：`basic` 的 keys 末尾加 `KEY.Protocol, KEY.Inbound`；`outbound` 的 keys 末尾加 `KEY.FromOutbound, KEY.OutboundType`。（空值和 `-` 已由 `rowsOf` 过滤，Clash / dae 下不会显示。）

4. `src/components/controls/ConnectionCtrl.tsx`：`...CONNECTION_GROUPABLE_KEYS.map(` 改为 `...CONNECTION_GROUPABLE_KEYS.filter(isConnectionKeyAvailable).map(`。

5. `src/components/settings/connections/TableSettings.vue`：`restOfColumns` 的过滤条件改为 `(key) => !connectionTableColumns.value.includes(key) && isConnectionKeyAvailable(key)`。

6. `src/components/settings/connections/ConnectionCardSettings.vue`：`setRestOfColumns` 的过滤条件改为 `(key) => !connectionCardLines.value.flat().includes(key) && isConnectionKeyAvailable(key)`。

搜索（`store/connections.ts`）不挂接：隐藏列在 sing-box API 下取值为空，对搜索无影响，而且那里依赖 `CONNECTION_SEARCHABLE_KEYS` 的引用相等做缓存。

- [ ] **Step 7: 文案**

`protocol` 已是上游已有的键。四个 fork i18n 文件各追加：

| key | en | zh | zh-tw | ru |
|---|---|---|---|---|
| `inbound` | `Inbound` | `入站` | `入站` | `Входящий` |
| `fromOutbound` | `From outbound` | `来源出站` | `來源出站` | `Из исходящего` |
| `outboundType` | `Outbound type` | `出站类型` | `出站類型` | `Тип исходящего` |

- [ ] **Step 8: 全量检查并提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test && pnpm build
git add src/assembly/singbox/connection-keys.ts src/assembly/singbox/connection-events.ts src/constant/index.ts src/assembly/driver/types.ts src/assembly/connections.ts src/components/connections src/components/controls/ConnectionCtrl.tsx src/components/settings/connections src/i18n/singbox fork-test/singbox/api/connection-keys.test.ts
git commit -m "feat(singbox): add sing-box connection columns and hide sniff host under the API"
```

---

### Task 13: 工具页路由、网络质量与 STUN

**Files:**
- Create: `src/assembly/singbox/tools/common.ts`, `src/assembly/singbox/tools/network-quality.ts`, `src/assembly/singbox/tools/stun.ts`, `src/views/ToolsPage.vue`, `src/components/singbox/tools/ToolSection.vue`, `src/components/singbox/tools/StatCell.vue`, `src/components/singbox/tools/OutboundSelect.vue`, `src/components/singbox/tools/NetworkQualityCard.vue`, `src/components/singbox/tools/StunCard.vue`
- Modify: `src/constant/index.ts:1-9,247-265`, `src/router/index.ts`, `src/helper/index.ts:1,95-101`, `src/i18n/singbox/*.ts`
- Test: `fork-test/singbox/api/tools.test.ts`

**Interfaces:**
- Consumes: `serverStream`（Task 5），`SharedStream`（Task 3），`proxyMap`，`can('tools')`。
- Produces:
  - `tools/common.ts`：`outboundTags: ComputedRef<string[]>`（去掉 `GLOBAL`）、`toolErrorMessage(error): string`、`useSharedStream<T>(stream): { data: ShallowRef<T | undefined>; phase; error }`（onMounted 订阅、onUnmounted 退订）、`type StreamingRun = { cancel(): void; done: Promise<void> }`、`runStreaming<T>(open, onValue): StreamingRun`
  - `tools/network-quality.ts`：`type NetworkQualityOptions`、`NETWORK_QUALITY_DEFAULTS`、`type NetworkQualityResult`、`toNetworkQualityResult(progress)`、`startNetworkQualityTest(options, onProgress): StreamingRun`
  - `tools/stun.ts`：`STUN_DEFAULT_SERVER`、`type NatBehavior`、`type StunResult`、`toStunResult(progress)`、`startStunTest(options, onProgress): StreamingRun`
  - 组件 `ToolSection`（props `title: string; empty?: boolean`，默认插槽与 `actions` 插槽）、`StatCell`（props `label; value; hint?`）、`OutboundSelect`（`v-model: string`）
  - `ROUTE_NAME.tools = 'tools'`

- [ ] **Step 1: 写失败的测试**

`fork-test/singbox/api/tools.test.ts`：

```ts
import {
  NetworkQualityTestProgressSchema,
  STUNTestProgressSchema,
} from '@/assembly/singbox/api/gen/daemon/started_service_pb'
import { runStreaming } from '@/assembly/singbox/tools/common'
import { toNetworkQualityResult } from '@/assembly/singbox/tools/network-quality'
import { toStunResult } from '@/assembly/singbox/tools/stun'
import { create } from '@bufbuild/protobuf'
import { describe, expect, it, vi } from 'vitest'

describe('network quality', () => {
  it('maps progress', () => {
    const result = toNetworkQualityResult(
      create(NetworkQualityTestProgressSchema, {
        phase: 2,
        downloadCapacity: 250_000_000n,
        uploadCapacity: 20_000_000n,
        downloadRPM: 900,
        uploadRPM: 400,
        idleLatencyMs: 12,
        elapsedMs: 8000n,
        downloadCapacityAccuracy: 2,
        uploadCapacityAccuracy: 1,
      }),
    )

    expect(result.phase).toBe('upload')
    expect(result.downloadMbps).toBe(250)
    expect(result.uploadMbps).toBe(20)
    expect(result.elapsedMs).toBe(8000)
    expect(result.accuracy.downloadCapacity).toBe('high')
    expect(result.accuracy.uploadCapacity).toBe('medium')
    expect(result.accuracy.downloadRPM).toBe('low')
  })
})

describe('stun', () => {
  it('maps NAT behaviours, skipping the reserved mapping value', () => {
    const result = toStunResult(
      create(STUNTestProgressSchema, {
        phase: 3,
        externalAddr: '1.2.3.4:5000',
        latencyMs: 30,
        natMapping: 2,
        natFiltering: 3,
        isFinal: true,
        natTypeSupported: true,
      }),
    )

    expect(result.phase).toBe('done')
    expect(result.natMapping).toBe('endpointIndependent')
    expect(result.natFiltering).toBe('addressAndPortDependent')
    expect(toStunResult(create(STUNTestProgressSchema, { natMapping: 1 })).natMapping).toBe(
      'unknown',
    )
  })
})

describe('runStreaming', () => {
  it('delivers values and stops on cancel', async () => {
    const values: number[] = []
    const run = runStreaming(
      async function* (signal) {
        yield 1
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
      },
      (value) => values.push(value),
    )

    await vi.waitFor(() => expect(values).toEqual([1]))
    run.cancel()
    await run.done
    expect(values).toEqual([1])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm -C fork-test exec vitest run singbox/api/tools.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现工具门面**

`src/assembly/singbox/tools/common.ts`：

```ts
import { proxyMap } from '@/assembly/proxies'
import { ConnectError } from '@connectrpc/connect'
import { computed, onMounted, onUnmounted, shallowRef } from 'vue'
import type { SharedStream } from '../api/stream'

export type StreamingRun = {
  cancel: () => void
  done: Promise<void>
}

export const outboundTags = computed(() =>
  Object.keys(proxyMap.value)
    .filter((name) => name !== 'GLOBAL')
    .sort((a, b) => a.localeCompare(b)),
)

export const toolErrorMessage = (error: unknown) => ConnectError.from(error).rawMessage

export const useSharedStream = <T>(stream: SharedStream<T>) => {
  const data = shallowRef<T>()
  let off: (() => void) | undefined

  onMounted(() => {
    off = stream.subscribe((value) => {
      data.value = value
    })
  })
  onUnmounted(() => off?.())

  return { data, phase: stream.phase, error: stream.error }
}

export const runStreaming = <T>(
  open: (signal: AbortSignal) => AsyncIterable<T>,
  onValue: (value: T) => void,
): StreamingRun => {
  const controller = new AbortController()
  const done = (async () => {
    for await (const value of open(controller.signal)) onValue(value)
  })()

  return { cancel: () => controller.abort(), done }
}
```

`src/assembly/singbox/tools/network-quality.ts`：

```ts
import { serverStream } from '../api/client'
import {
  StartedService,
  type NetworkQualityTestProgress,
} from '../api/gen/daemon/started_service_pb'
import { runStreaming } from './common'

export type NetworkQualityOptions = {
  configURL: string
  outboundTag: string
  serial: boolean
  http3: boolean
  maxRuntimeSeconds: number
}

export type Accuracy = 'low' | 'medium' | 'high'

export type NetworkQualityResult = {
  phase: 'idle' | 'download' | 'upload' | 'done'
  downloadMbps: number
  uploadMbps: number
  downloadRPM: number
  uploadRPM: number
  idleLatencyMs: number
  elapsedMs: number
  isFinal: boolean
  error: string
  accuracy: {
    downloadCapacity: Accuracy
    uploadCapacity: Accuracy
    downloadRPM: Accuracy
    uploadRPM: Accuracy
  }
}

export const NETWORK_QUALITY_DEFAULTS: NetworkQualityOptions = {
  configURL: 'https://mensura.cdn-apple.com/api/v1/gm/config',
  outboundTag: '',
  serial: false,
  http3: false,
  maxRuntimeSeconds: 0,
}

const PHASES = ['idle', 'download', 'upload', 'done'] as const
const ACCURACY = ['low', 'medium', 'high'] as const

const accuracyOf = (value: number): Accuracy => ACCURACY[value] ?? 'low'

export const toNetworkQualityResult = (
  progress: NetworkQualityTestProgress,
): NetworkQualityResult => ({
  phase: PHASES[progress.phase] ?? 'idle',
  downloadMbps: Number(progress.downloadCapacity) / 1_000_000,
  uploadMbps: Number(progress.uploadCapacity) / 1_000_000,
  downloadRPM: progress.downloadRPM,
  uploadRPM: progress.uploadRPM,
  idleLatencyMs: progress.idleLatencyMs,
  elapsedMs: Number(progress.elapsedMs),
  isFinal: progress.isFinal,
  error: progress.error,
  accuracy: {
    downloadCapacity: accuracyOf(progress.downloadCapacityAccuracy),
    uploadCapacity: accuracyOf(progress.uploadCapacityAccuracy),
    downloadRPM: accuracyOf(progress.downloadRPMAccuracy),
    uploadRPM: accuracyOf(progress.uploadRPMAccuracy),
  },
})

export const startNetworkQualityTest = (
  options: NetworkQualityOptions,
  onProgress: (result: NetworkQualityResult) => void,
) =>
  runStreaming(
    (signal) => serverStream(StartedService.method.startNetworkQualityTest, options, signal),
    (progress) => onProgress(toNetworkQualityResult(progress)),
  )
```

`src/assembly/singbox/tools/stun.ts`：

```ts
import { serverStream } from '../api/client'
import { StartedService, type STUNTestProgress } from '../api/gen/daemon/started_service_pb'
import { runStreaming } from './common'

export const STUN_DEFAULT_SERVER = 'stun.voipgate.com:3478'

export type NatBehavior =
  | 'unknown'
  | 'endpointIndependent'
  | 'addressDependent'
  | 'addressAndPortDependent'

export type StunResult = {
  phase: 'binding' | 'mapping' | 'filtering' | 'done'
  externalAddr: string
  latencyMs: number
  natMapping: NatBehavior
  natFiltering: NatBehavior
  natTypeSupported: boolean
  isFinal: boolean
  error: string
}

const PHASES = ['binding', 'mapping', 'filtering', 'done'] as const
const MAPPING: NatBehavior[] = [
  'unknown',
  'unknown',
  'endpointIndependent',
  'addressDependent',
  'addressAndPortDependent',
]
const FILTERING: NatBehavior[] = [
  'unknown',
  'endpointIndependent',
  'addressDependent',
  'addressAndPortDependent',
]

export const toStunResult = (progress: STUNTestProgress): StunResult => ({
  phase: PHASES[progress.phase] ?? 'binding',
  externalAddr: progress.externalAddr,
  latencyMs: progress.latencyMs,
  natMapping: MAPPING[progress.natMapping] ?? 'unknown',
  natFiltering: FILTERING[progress.natFiltering] ?? 'unknown',
  natTypeSupported: progress.natTypeSupported,
  isFinal: progress.isFinal,
  error: progress.error,
})

export const startStunTest = (
  options: { server: string; outboundTag: string },
  onProgress: (result: StunResult) => void,
) =>
  runStreaming(
    (signal) => serverStream(StartedService.method.startSTUNTest, options, signal),
    (progress) => onProgress(toStunResult(progress)),
  )
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm -C fork-test exec vitest run singbox/api/tools.test.ts`
Expected: PASS。

- [ ] **Step 5: 通用组件**

`src/components/singbox/tools/ToolSection.vue`：

```vue
<template>
  <div class="base-container w-full">
    <div class="surface flex items-center justify-between gap-2 p-4">
      <div class="text-base-content/60 text-xs font-semibold tracking-wider uppercase">
        {{ title }}
      </div>
      <slot name="actions" />
    </div>
    <div
      v-if="empty"
      class="surface text-base-content/60 px-4 pb-4 text-sm"
    >
      {{ $t('toolNotConfigured') }}
    </div>
    <div
      v-else
      class="surface flex flex-col gap-3 px-4 pb-4 text-sm"
    >
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  empty?: boolean
}>()
</script>
```

`src/components/singbox/tools/StatCell.vue`：

```vue
<template>
  <div class="bg-base-200/30 flex flex-col gap-1 rounded-xl p-3">
    <div class="text-base-content/60 text-xs font-semibold tracking-wider uppercase">
      {{ label }}
    </div>
    <div class="text-xl font-extralight break-all tabular-nums">{{ value }}</div>
    <div
      v-if="hint"
      class="text-base-content/50 text-xs"
    >
      {{ hint }}
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label: string
  value: string
  hint?: string
}>()
</script>
```

`src/components/singbox/tools/OutboundSelect.vue`：

```vue
<template>
  <select
    v-model="model"
    class="select select-sm min-w-0 flex-1"
  >
    <option value="">{{ $t('toolDefaultRoute') }}</option>
    <option
      v-for="tag in outboundTags"
      :key="tag"
      :value="tag"
    >
      {{ tag }}
    </option>
  </select>
</template>

<script setup lang="ts">
import { outboundTags } from '@/assembly/singbox/tools/common'

const model = defineModel<string>({ required: true })
</script>
```

- [ ] **Step 6: 网络质量与 STUN 卡片**

`src/components/singbox/tools/NetworkQualityCard.vue`：

```vue
<template>
  <ToolSection :title="$t('networkQuality')">
    <div class="flex flex-wrap items-center gap-2">
      <input
        v-model="options.configURL"
        class="input input-sm min-w-0 flex-1"
        :placeholder="$t('networkQualityConfigURL')"
      />
      <OutboundSelect v-model="options.outboundTag" />
    </div>
    <div class="flex flex-wrap items-center gap-4">
      <label class="flex items-center gap-2">
        <input
          v-model="options.serial"
          type="checkbox"
          class="toggle toggle-sm"
        />
        {{ $t('networkQualitySerial') }}
      </label>
      <label class="flex items-center gap-2">
        <input
          v-model="options.http3"
          type="checkbox"
          class="toggle toggle-sm"
        />
        HTTP/3
      </label>
      <div class="flex-1"></div>
      <button
        class="btn btn-sm"
        :class="run ? 'btn-error' : 'btn-primary'"
        @click="toggle"
      >
        {{ run ? $t('toolCancel') : $t('toolStart') }}
      </button>
    </div>
    <template v-if="result">
      <div class="text-base-content/60 text-xs">
        {{ $t(PHASE_KEYS[result.phase]) }} · {{ (result.elapsedMs / 1000).toFixed(1) }}s
      </div>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <StatCell
          :label="$t('networkQualityDownload')"
          :value="`${result.downloadMbps.toFixed(1)} Mbps`"
          :hint="$t(ACCURACY_KEYS[result.accuracy.downloadCapacity])"
        />
        <StatCell
          :label="$t('networkQualityUpload')"
          :value="`${result.uploadMbps.toFixed(1)} Mbps`"
          :hint="$t(ACCURACY_KEYS[result.accuracy.uploadCapacity])"
        />
        <StatCell
          :label="$t('networkQualityDownloadRPM')"
          :value="String(result.downloadRPM)"
          :hint="$t(ACCURACY_KEYS[result.accuracy.downloadRPM])"
        />
        <StatCell
          :label="$t('networkQualityUploadRPM')"
          :value="String(result.uploadRPM)"
          :hint="$t(ACCURACY_KEYS[result.accuracy.uploadRPM])"
        />
        <StatCell
          :label="$t('networkQualityIdleLatency')"
          :value="`${result.idleLatencyMs} ms`"
        />
      </div>
    </template>
    <div
      v-if="error"
      class="text-error text-sm"
    >
      {{ error }}
    </div>
  </ToolSection>
</template>

<script setup lang="ts">
import { toolErrorMessage, type StreamingRun } from '@/assembly/singbox/tools/common'
import {
  NETWORK_QUALITY_DEFAULTS,
  startNetworkQualityTest,
  type Accuracy,
  type NetworkQualityResult,
} from '@/assembly/singbox/tools/network-quality'
import { onUnmounted, reactive, ref, shallowRef } from 'vue'
import OutboundSelect from './OutboundSelect.vue'
import StatCell from './StatCell.vue'
import ToolSection from './ToolSection.vue'

const PHASE_KEYS: Record<NetworkQualityResult['phase'], string> = {
  idle: 'networkQualityIdle',
  download: 'networkQualityDownloading',
  upload: 'networkQualityUploading',
  done: 'networkQualityDone',
}

const ACCURACY_KEYS: Record<Accuracy, string> = {
  low: 'accuracyLow',
  medium: 'accuracyMedium',
  high: 'accuracyHigh',
}

const options = reactive({ ...NETWORK_QUALITY_DEFAULTS })
const result = shallowRef<NetworkQualityResult>()
const error = ref('')
const run = shallowRef<StreamingRun>()

const toggle = () => {
  if (run.value) {
    run.value.cancel()
    return
  }

  result.value = undefined
  error.value = ''

  const current = startNetworkQualityTest({ ...options }, (progress) => {
    result.value = progress
    if (progress.error) error.value = progress.error
  })

  run.value = current
  current.done
    .catch((e: unknown) => {
      error.value = toolErrorMessage(e)
    })
    .finally(() => {
      if (run.value === current) run.value = undefined
    })
}

onUnmounted(() => run.value?.cancel())
</script>
```

`src/components/singbox/tools/StunCard.vue`：

```vue
<template>
  <ToolSection :title="$t('stunTest')">
    <div class="flex flex-wrap items-center gap-2">
      <input
        v-model="server"
        class="input input-sm min-w-0 flex-1"
        :placeholder="$t('stunServer')"
      />
      <OutboundSelect v-model="outboundTag" />
      <button
        class="btn btn-sm"
        :class="run ? 'btn-error' : 'btn-primary'"
        @click="toggle"
      >
        {{ run ? $t('toolCancel') : $t('toolStart') }}
      </button>
    </div>
    <template v-if="result">
      <div class="text-base-content/60 text-xs">{{ $t(PHASE_KEYS[result.phase]) }}</div>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCell
          :label="$t('stunExternalAddress')"
          :value="result.externalAddr || '-'"
        />
        <StatCell
          :label="$t('stunLatency')"
          :value="`${result.latencyMs} ms`"
        />
        <StatCell
          :label="$t('stunNatMapping')"
          :value="natLabel(result.natMapping)"
        />
        <StatCell
          :label="$t('stunNatFiltering')"
          :value="natLabel(result.natFiltering)"
        />
      </div>
      <div
        v-if="result.isFinal && !result.natTypeSupported"
        class="text-base-content/60 text-xs"
      >
        {{ $t('stunNatUnsupported') }}
      </div>
    </template>
    <div
      v-if="error"
      class="text-error text-sm"
    >
      {{ error }}
    </div>
  </ToolSection>
</template>

<script setup lang="ts">
import { toolErrorMessage, type StreamingRun } from '@/assembly/singbox/tools/common'
import {
  startStunTest,
  STUN_DEFAULT_SERVER,
  type NatBehavior,
  type StunResult,
} from '@/assembly/singbox/tools/stun'
import { onUnmounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import OutboundSelect from './OutboundSelect.vue'
import StatCell from './StatCell.vue'
import ToolSection from './ToolSection.vue'

const { t } = useI18n()

const PHASE_KEYS: Record<StunResult['phase'], string> = {
  binding: 'stunBinding',
  mapping: 'stunMapping',
  filtering: 'stunFiltering',
  done: 'stunDone',
}

const NAT_KEYS: Record<NatBehavior, string> = {
  unknown: 'natUnknown',
  endpointIndependent: 'natEndpointIndependent',
  addressDependent: 'natAddressDependent',
  addressAndPortDependent: 'natAddressAndPortDependent',
}

const natLabel = (behavior: NatBehavior) => t(NAT_KEYS[behavior])

const server = ref(STUN_DEFAULT_SERVER)
const outboundTag = ref('')
const result = shallowRef<StunResult>()
const error = ref('')
const run = shallowRef<StreamingRun>()

const toggle = () => {
  if (run.value) {
    run.value.cancel()
    return
  }

  result.value = undefined
  error.value = ''

  const current = startStunTest(
    { server: server.value, outboundTag: outboundTag.value },
    (progress) => {
      result.value = progress
      if (progress.error) error.value = progress.error
    },
  )

  run.value = current
  current.done
    .catch((e: unknown) => {
      error.value = toolErrorMessage(e)
    })
    .finally(() => {
      if (run.value === current) run.value = undefined
    })
}

onUnmounted(() => run.value?.cancel())
</script>
```

- [ ] **Step 7: 页面与路由挂接**

`src/views/ToolsPage.vue`：

```vue
<template>
  <div
    class="h-full overflow-x-hidden overflow-y-auto"
    :style="padding"
  >
    <div class="flex flex-col gap-3 p-3">
      <NetworkQualityCard />
      <StunCard />
    </div>
  </div>
</template>

<script setup lang="ts">
import NetworkQualityCard from '@/components/singbox/tools/NetworkQualityCard.vue'
import StunCard from '@/components/singbox/tools/StunCard.vue'
import { usePaddingForViews } from '@/composables/use-padding-for-views'

const { padding } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})
</script>
```

`src/constant/index.ts`：

- heroicons 的 import 列表里加 `WrenchScrewdriverIcon`（按字母序放在 `SwatchIcon` 之后）。
- `ROUTE_NAME` 在 `rules = 'rules',` 之后加 `tools = 'tools',`。
- `ROUTE_ICON_MAP` 在 `[ROUTE_NAME.logs]` 之后加 `[ROUTE_NAME.tools]: WrenchScrewdriverIcon,`。

`src/router/index.ts`：

- imports 加 `import { can } from '@/assembly/backend'` 和 `import { coreReady } from '@/assembly/version'`。
- `childrenRouter` 在 `rules` 之后加：

```ts
  {
    path: 'tools',
    name: ROUTE_NAME.tools,
    component: () => import('@/views/ToolsPage.vue'),
  },
```

- 在现有 `router.beforeEach(...)` 之后加：

```ts
router.beforeEach(async (to) => {
  if (to.name !== ROUTE_NAME.tools) return
  await coreReady()
  if (!can('tools')) return { name: ROUTE_NAME.proxies }
})

watch(
  () => can('tools'),
  (available) => {
    if (!available && router.currentRoute.value.name === ROUTE_NAME.tools) {
      router.push({ name: ROUTE_NAME.proxies })
    }
  },
)
```

`src/helper/index.ts`：imports 加 `import { can } from '@/assembly/backend'`；`renderRoutes` 的过滤里在 overview 判断之后加 `if (r === ROUTE_NAME.tools && !can('tools')) return false`。

- [ ] **Step 8: 文案**

四个 fork i18n 文件各追加：

| key | en | zh | zh-tw | ru |
|---|---|---|---|---|
| `tools` | `Tools` | `工具` | `工具` | `Инструменты` |
| `toolNotConfigured` | `Not configured` | `未配置` | `未設定` | `Не настроено` |
| `toolStart` | `Start` | `开始` | `開始` | `Запустить` |
| `toolCancel` | `Cancel` | `取消` | `取消` | `Отмена` |
| `toolDefaultRoute` | `Default route` | `默认路由` | `預設路由` | `Маршрут по умолчанию` |
| `networkQuality` | `Network quality` | `网络质量` | `網路品質` | `Качество сети` |
| `networkQualityConfigURL` | `Config URL` | `配置 URL` | `設定 URL` | `URL конфигурации` |
| `networkQualitySerial` | `Serial` | `串行` | `序列` | `Последовательно` |
| `networkQualityDownload` | `Download` | `下行` | `下行` | `Загрузка` |
| `networkQualityUpload` | `Upload` | `上行` | `上行` | `Отдача` |
| `networkQualityDownloadRPM` | `Download RPM` | `下行 RPM` | `下行 RPM` | `RPM загрузки` |
| `networkQualityUploadRPM` | `Upload RPM` | `上行 RPM` | `上行 RPM` | `RPM отдачи` |
| `networkQualityIdleLatency` | `Idle latency` | `空闲延迟` | `閒置延遲` | `Задержка в простое` |
| `networkQualityIdle` | `Preparing` | `准备中` | `準備中` | `Подготовка` |
| `networkQualityDownloading` | `Testing download` | `正在测试下行` | `正在測試下行` | `Проверка загрузки` |
| `networkQualityUploading` | `Testing upload` | `正在测试上行` | `正在測試上行` | `Проверка отдачи` |
| `networkQualityDone` | `Done` | `完成` | `完成` | `Готово` |
| `accuracyLow` | `Low accuracy` | `精度低` | `精度低` | `Низкая точность` |
| `accuracyMedium` | `Medium accuracy` | `精度中` | `精度中` | `Средняя точность` |
| `accuracyHigh` | `High accuracy` | `精度高` | `精度高` | `Высокая точность` |
| `stunTest` | `STUN / NAT` | `STUN / NAT` | `STUN / NAT` | `STUN / NAT` |
| `stunServer` | `STUN server` | `STUN 服务器` | `STUN 伺服器` | `STUN-сервер` |
| `stunExternalAddress` | `External address` | `外部地址` | `外部位址` | `Внешний адрес` |
| `stunLatency` | `Latency` | `延迟` | `延遲` | `Задержка` |
| `stunNatMapping` | `NAT mapping` | `NAT 映射` | `NAT 映射` | `NAT-отображение` |
| `stunNatFiltering` | `NAT filtering` | `NAT 过滤` | `NAT 過濾` | `NAT-фильтрация` |
| `stunNatUnsupported` | `The server cannot determine the NAT type` | `该服务器无法判定 NAT 类型` | `該伺服器無法判定 NAT 類型` | `Сервер не может определить тип NAT` |
| `stunBinding` | `Binding` | `绑定中` | `綁定中` | `Привязка` |
| `stunMapping` | `Testing mapping` | `正在测试映射` | `正在測試映射` | `Проверка отображения` |
| `stunFiltering` | `Testing filtering` | `正在测试过滤` | `正在測試過濾` | `Проверка фильтрации` |
| `stunDone` | `Done` | `完成` | `完成` | `Готово` |
| `natUnknown` | `Unknown` | `未知` | `未知` | `Неизвестно` |
| `natEndpointIndependent` | `Endpoint independent` | `与端点无关` | `與端點無關` | `Не зависит от адреса` |
| `natAddressDependent` | `Address dependent` | `与地址相关` | `與位址相關` | `Зависит от адреса` |
| `natAddressAndPortDependent` | `Address and port dependent` | `与地址和端口相关` | `與位址和連接埠相關` | `Зависит от адреса и порта` |

- [ ] **Step 9: 全量检查并提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test && pnpm build
rg -l "grpc-websockets" dist/assets/index-*.js || echo "main chunk clean"
git add src/assembly/singbox/tools src/views/ToolsPage.vue src/components/singbox/tools src/constant/index.ts src/router/index.ts src/helper/index.ts src/i18n/singbox fork-test/singbox/api/tools.test.ts
git commit -m "feat(singbox): add tools page with network quality and STUN tests"
```

---

### Task 14: eBPF 诊断

**Files:**
- Create: `src/assembly/singbox/tools/ebpf.ts`, `src/components/singbox/tools/EbpfCard.vue`
- Modify: `src/views/ToolsPage.vue`, `src/i18n/singbox/*.ts`
- Test: `fork-test/singbox/api/tools.test.ts`（追加）

**Interfaces:**
- Consumes: `api()`（Task 5），`ToolSection`、`StatCell`（Task 13）。
- Produces: `type EbpfInboundSummary = { tag: string; state: string; dataPlane: string; udpSessions: number; lastError: string; detail: JsonValue }`、`type EbpfDiagnostics = { inbounds: EbpfInboundSummary[]; kernelRuntime: JsonValue | undefined }`、`toEbpfDiagnostics(response: EBPFDiagnosticsResponse): EbpfDiagnostics`、`fetchEbpfDiagnostics(): Promise<EbpfDiagnostics>`。

- [ ] **Step 1: 追加失败的测试**

`fork-test/singbox/api/tools.test.ts` 追加 import `EBPFDiagnosticsResponseSchema` 与 `toEbpfDiagnostics`（来自 `@/assembly/singbox/tools/ebpf`），末尾追加：

```ts
describe('ebpf', () => {
  it('summarises inbounds and keeps json details', () => {
    const diagnostics = toEbpfDiagnostics(
      create(EBPFDiagnosticsResponseSchema, {
        inbounds: [
          {
            tag: 'ebpf-in',
            state: 'running',
            localEnabled: true,
            localDataPlane: 'tc',
            sharedEnabled: false,
            udpSessionCount: 7n,
            lastError: '',
          },
        ],
        kernelRuntime: { observedAt: 1n, programsError: 'denied' },
      }),
    )

    expect(diagnostics.inbounds).toHaveLength(1)
    expect(diagnostics.inbounds[0]).toMatchObject({
      tag: 'ebpf-in',
      state: 'running',
      dataPlane: 'tc',
      udpSessions: 7,
      lastError: '',
    })
    expect(diagnostics.inbounds[0].detail).toMatchObject({ tag: 'ebpf-in', udpSessionCount: '7' })
    expect(diagnostics.kernelRuntime).toMatchObject({ programsError: 'denied' })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm -C fork-test exec vitest run singbox/api/tools.test.ts`
Expected: FAIL，`ebpf` 模块不存在。

- [ ] **Step 3: 实现 ebpf.ts**

```ts
import { toJson, type JsonValue } from '@bufbuild/protobuf'
import { api } from '../api/client'
import {
  EBPFInboundDiagnosticsSchema,
  EBPFKernelRuntimeDiagnosticsSchema,
  type EBPFDiagnosticsResponse,
} from '../api/gen/daemon/started_service_pb'

export type EbpfInboundSummary = {
  tag: string
  state: string
  dataPlane: string
  udpSessions: number
  lastError: string
  detail: JsonValue
}

export type EbpfDiagnostics = {
  inbounds: EbpfInboundSummary[]
  kernelRuntime: JsonValue | undefined
}

export const toEbpfDiagnostics = (response: EBPFDiagnosticsResponse): EbpfDiagnostics => ({
  inbounds: response.inbounds.map((inbound) => ({
    tag: inbound.tag,
    state: inbound.state,
    dataPlane: [
      inbound.localEnabled && inbound.localDataPlane,
      inbound.sharedEnabled && inbound.sharedDataPlane,
    ]
      .filter(Boolean)
      .join(' / '),
    udpSessions: Number(inbound.udpSessionCount),
    lastError: inbound.lastError,
    detail: toJson(EBPFInboundDiagnosticsSchema, inbound),
  })),
  kernelRuntime: response.kernelRuntime
    ? toJson(EBPFKernelRuntimeDiagnosticsSchema, response.kernelRuntime)
    : undefined,
})

export const fetchEbpfDiagnostics = async () =>
  toEbpfDiagnostics(await api().getEBPFDiagnostics({}))
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm -C fork-test exec vitest run singbox/api/tools.test.ts`
Expected: PASS（proto3 JSON 省略零值字段，所以断言只针对非零字段；int64 在 JSON 里是字符串）。

- [ ] **Step 5: 卡片**

`src/components/singbox/tools/EbpfCard.vue`：

```vue
<template>
  <ToolSection
    :title="$t('ebpfDiagnostics')"
    :empty="loaded && !diagnostics?.inbounds.length && !diagnostics?.kernelRuntime"
  >
    <template #actions>
      <button
        class="btn btn-sm"
        :disabled="loading"
        @click="refresh"
      >
        {{ $t('ebpfRefresh') }}
      </button>
    </template>
    <div
      v-for="inbound in diagnostics?.inbounds ?? []"
      :key="inbound.tag"
      class="flex flex-col gap-2"
    >
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCell
          :label="$t('inbound')"
          :value="inbound.tag"
        />
        <StatCell
          :label="$t('ebpfState')"
          :value="inbound.state || '-'"
        />
        <StatCell
          :label="$t('ebpfDataPlane')"
          :value="inbound.dataPlane || '-'"
        />
        <StatCell
          :label="$t('ebpfUdpSessions')"
          :value="String(inbound.udpSessions)"
        />
      </div>
      <div
        v-if="inbound.lastError"
        class="text-error text-xs"
      >
        {{ $t('ebpfLastError') }}: {{ inbound.lastError }}
      </div>
      <details class="collapse-arrow bg-base-200/30 collapse rounded-xl">
        <summary class="collapse-title text-xs">{{ inbound.tag }}</summary>
        <div class="collapse-content overflow-x-auto">
          <VueJsonPretty :data="inbound.detail" />
        </div>
      </details>
    </div>
    <details
      v-if="diagnostics?.kernelRuntime"
      class="collapse-arrow bg-base-200/30 collapse rounded-xl"
    >
      <summary class="collapse-title text-xs">{{ $t('ebpfKernelRuntime') }}</summary>
      <div class="collapse-content overflow-x-auto">
        <VueJsonPretty :data="diagnostics.kernelRuntime" />
      </div>
    </details>
    <div
      v-if="error"
      class="text-error text-sm"
    >
      {{ error }}
    </div>
  </ToolSection>
</template>

<script setup lang="ts">
import { toolErrorMessage } from '@/assembly/singbox/tools/common'
import { fetchEbpfDiagnostics, type EbpfDiagnostics } from '@/assembly/singbox/tools/ebpf'
import { onMounted, ref, shallowRef } from 'vue'
import VueJsonPretty from 'vue-json-pretty'
import 'vue-json-pretty/lib/styles.css'
import StatCell from './StatCell.vue'
import ToolSection from './ToolSection.vue'

const diagnostics = shallowRef<EbpfDiagnostics>()
const error = ref('')
const loading = ref(false)
const loaded = ref(false)

const refresh = async () => {
  loading.value = true
  error.value = ''
  try {
    diagnostics.value = await fetchEbpfDiagnostics()
  } catch (e) {
    error.value = toolErrorMessage(e)
  } finally {
    loading.value = false
    loaded.value = true
  }
}

onMounted(refresh)
</script>
```

`src/views/ToolsPage.vue`：在 `<StunCard />` 之后加 `<EbpfCard v-if="can('ebpfDiagnostics')" />`；imports 加 `import { can } from '@/assembly/backend'` 与 `import EbpfCard from '@/components/singbox/tools/EbpfCard.vue'`。

- [ ] **Step 6: 文案**

| key | en | zh | zh-tw | ru |
|---|---|---|---|---|
| `ebpfDiagnostics` | `eBPF diagnostics` | `eBPF 诊断` | `eBPF 診斷` | `Диагностика eBPF` |
| `ebpfRefresh` | `Refresh` | `刷新` | `重新整理` | `Обновить` |
| `ebpfKernelRuntime` | `Kernel runtime` | `内核运行时` | `核心執行階段` | `Среда ядра` |
| `ebpfState` | `State` | `状态` | `狀態` | `Состояние` |
| `ebpfDataPlane` | `Data plane` | `数据面` | `資料面` | `Плоскость данных` |
| `ebpfUdpSessions` | `UDP sessions` | `UDP 会话` | `UDP 工作階段` | `UDP-сессии` |
| `ebpfLastError` | `Last error` | `最近错误` | `最近錯誤` | `Последняя ошибка` |

- [ ] **Step 7: 全量检查并提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test && pnpm build
git add src/assembly/singbox/tools/ebpf.ts src/components/singbox/tools/EbpfCard.vue src/views/ToolsPage.vue src/i18n/singbox fork-test/singbox/api/tools.test.ts
git commit -m "feat(singbox): add eBPF diagnostics to tools page"
```

---

### Task 15: Tailscale

**Files:**
- Create: `src/assembly/singbox/tools/tailscale.ts`, `src/components/singbox/tools/TailscaleCard.vue`, `src/components/singbox/tools/TailscaleEndpoint.vue`, `src/components/singbox/tools/TailscalePeer.vue`
- Modify: `src/views/ToolsPage.vue`, `src/i18n/singbox/*.ts`
- Test: `fork-test/singbox/api/tailscale.test.ts`

**Interfaces:**
- Consumes: `createSharedStream`（Task 3），`serverStream`、`api()`（Task 5），`useSharedStream`、`runStreaming`、`toolErrorMessage`、`ToolSection`、`StatCell`（Task 13），`uqr` 的 `renderSVG`。
- Produces:
  - `tailscaleStream: SharedStream<TailscaleStatusUpdate>`
  - `type TailscalePeerView = { stableID: string; hostName: string; dnsName: string; os: string; ips: string[]; online: boolean; active: boolean; exitNode: boolean; exitNodeOption: boolean; rxBytes: number; txBytes: number; keyExpiry: number; expired: boolean; lastSeen: number }`
  - `type TailscaleUserView = { id: string; name: string; peers: TailscalePeerView[] }`
  - `type TailscaleEndpointView = { tag: string; backendState: string; stateText: string; authURL: string; networkName: string; magicDNSSuffix: string; self?: TailscalePeerView; exitNode?: TailscalePeerView; users: TailscaleUserView[]; exitNodeOptions: TailscalePeerView[] }`
  - `toTailscaleEndpoints(update: TailscaleStatusUpdate): TailscaleEndpointView[]`
  - `setTailscaleExitNode(endpointTag: string, stableID: string): Promise<void>`、`logoutTailscale(endpointTag: string): Promise<void>`
  - `type TailscalePingSample = { latencyMs: number; isDirect: boolean; endpoint: string; derpRegionCode: string; error: string }`、`startTailscalePing(endpointTag, peerIP, onSample): StreamingRun`、`PING_HISTORY = 30`

- [ ] **Step 1: 写失败的测试**

`fork-test/singbox/api/tailscale.test.ts`：

```ts
import { TailscaleStatusUpdateSchema } from '@/assembly/singbox/api/gen/daemon/started_service_pb'
import { toTailscaleEndpoints } from '@/assembly/singbox/tools/tailscale'
import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'

const peer = (hostName: string, extra: Record<string, unknown> = {}) => ({
  hostName,
  dnsName: `${hostName}.example.ts.net.`,
  os: 'linux',
  tailscaleIPs: [`100.64.0.${hostName.length}`],
  online: true,
  stableID: `id-${hostName}`,
  rxBytes: 10n,
  txBytes: 20n,
  keyExpiry: 1_700_000_000n,
  ...extra,
})

describe('toTailscaleEndpoints', () => {
  it('maps endpoints, users, peers and exit node options', () => {
    const [endpoint] = toTailscaleEndpoints(
      create(TailscaleStatusUpdateSchema, {
        endpoints: [
          {
            endpointTag: 'ts',
            backendState: 'Running',
            stateText: 'Connected',
            networkName: 'example.ts.net',
            magicDNSSuffix: 'example.ts.net',
            self: peer('me'),
            exitNode: peer('gateway', { exitNode: true, exitNodeOption: true }),
            userGroups: [
              {
                userID: 1n,
                loginName: 'alice@example.com',
                displayName: 'Alice',
                peers: [peer('gateway', { exitNode: true, exitNodeOption: true }), peer('laptop', { online: false })],
              },
            ],
          },
        ],
      }),
    )

    expect(endpoint.tag).toBe('ts')
    expect(endpoint.self?.hostName).toBe('me')
    expect(endpoint.exitNode?.stableID).toBe('id-gateway')
    expect(endpoint.users).toEqual([
      expect.objectContaining({ id: '1', name: 'Alice', peers: [expect.objectContaining({ hostName: 'gateway' }), expect.objectContaining({ hostName: 'laptop', online: false })] }),
    ])
    expect(endpoint.users[0].peers[0].rxBytes).toBe(10)
    expect(endpoint.users[0].peers[0].keyExpiry).toBe(1_700_000_000)
    expect(endpoint.exitNodeOptions.map((item) => item.hostName)).toEqual(['gateway'])
  })

  it('falls back to the login name', () => {
    const [endpoint] = toTailscaleEndpoints(
      create(TailscaleStatusUpdateSchema, {
        endpoints: [{ endpointTag: 'ts', userGroups: [{ userID: 2n, loginName: 'bob@x', peers: [] }] }],
      }),
    )

    expect(endpoint.users[0].name).toBe('bob@x')
    expect(endpoint.self).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm -C fork-test exec vitest run singbox/api/tailscale.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 tailscale.ts**

```ts
import { api, serverStream } from '../api/client'
import {
  StartedService,
  type TailscalePeer,
  type TailscaleStatusUpdate,
} from '../api/gen/daemon/started_service_pb'
import { createSharedStream } from '../api/stream'
import { runStreaming } from './common'

export const PING_HISTORY = 30

export type TailscalePeerView = {
  stableID: string
  hostName: string
  dnsName: string
  os: string
  ips: string[]
  online: boolean
  active: boolean
  exitNode: boolean
  exitNodeOption: boolean
  rxBytes: number
  txBytes: number
  keyExpiry: number
  expired: boolean
  lastSeen: number
}

export type TailscaleUserView = {
  id: string
  name: string
  peers: TailscalePeerView[]
}

export type TailscaleEndpointView = {
  tag: string
  backendState: string
  stateText: string
  authURL: string
  networkName: string
  magicDNSSuffix: string
  self?: TailscalePeerView
  exitNode?: TailscalePeerView
  users: TailscaleUserView[]
  exitNodeOptions: TailscalePeerView[]
}

export type TailscalePingSample = {
  latencyMs: number
  isDirect: boolean
  endpoint: string
  derpRegionCode: string
  error: string
}

export const tailscaleStream = createSharedStream((signal) =>
  serverStream(StartedService.method.subscribeTailscaleStatus, {}, signal),
)

const toPeer = (peer: TailscalePeer): TailscalePeerView => ({
  stableID: peer.stableID,
  hostName: peer.hostName,
  dnsName: peer.dnsName,
  os: peer.os,
  ips: [...peer.tailscaleIPs],
  online: peer.online,
  active: peer.active,
  exitNode: peer.exitNode,
  exitNodeOption: peer.exitNodeOption,
  rxBytes: Number(peer.rxBytes),
  txBytes: Number(peer.txBytes),
  keyExpiry: Number(peer.keyExpiry),
  expired: peer.expired,
  lastSeen: Number(peer.lastSeen),
})

export const toTailscaleEndpoints = (update: TailscaleStatusUpdate): TailscaleEndpointView[] =>
  update.endpoints.map((endpoint) => {
    const users = endpoint.userGroups.map((group) => ({
      id: String(group.userID),
      name: group.displayName || group.loginName,
      peers: group.peers.map(toPeer),
    }))

    return {
      tag: endpoint.endpointTag,
      backendState: endpoint.backendState,
      stateText: endpoint.stateText,
      authURL: endpoint.authURL,
      networkName: endpoint.networkName,
      magicDNSSuffix: endpoint.magicDNSSuffix,
      self: endpoint.self ? toPeer(endpoint.self) : undefined,
      exitNode: endpoint.exitNode ? toPeer(endpoint.exitNode) : undefined,
      users,
      exitNodeOptions: users.flatMap((user) => user.peers).filter((peer) => peer.exitNodeOption),
    }
  })

export const setTailscaleExitNode = async (endpointTag: string, stableID: string) => {
  await api().setTailscaleExitNode({ endpointTag, stableID })
}

export const logoutTailscale = async (endpointTag: string) => {
  await api().tailscaleLogout({ endpointTag })
}

export const startTailscalePing = (
  endpointTag: string,
  peerIP: string,
  onSample: (sample: TailscalePingSample) => void,
) =>
  runStreaming(
    (signal) =>
      serverStream(StartedService.method.startTailscalePing, { endpointTag, peerIP }, signal),
    (response) =>
      onSample({
        latencyMs: response.latencyMs,
        isDirect: response.isDirect,
        endpoint: response.endpoint,
        derpRegionCode: response.derpRegionCode,
        error: response.error,
      }),
  )
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm -C fork-test exec vitest run singbox/api/tailscale.test.ts`
Expected: PASS。

- [ ] **Step 5: 组件**

`src/components/singbox/tools/TailscaleCard.vue`：

```vue
<template>
  <ToolSection
    :title="$t('tailscale')"
    :empty="phase === 'active' && endpoints.length === 0"
  >
    <TailscaleEndpoint
      v-for="endpoint in endpoints"
      :key="endpoint.tag"
      :endpoint="endpoint"
    />
    <div
      v-if="error"
      class="text-error text-sm"
    >
      {{ toolErrorMessage(error) }}
    </div>
  </ToolSection>
</template>

<script setup lang="ts">
import { toolErrorMessage, useSharedStream } from '@/assembly/singbox/tools/common'
import { tailscaleStream, toTailscaleEndpoints } from '@/assembly/singbox/tools/tailscale'
import { computed } from 'vue'
import TailscaleEndpoint from './TailscaleEndpoint.vue'
import ToolSection from './ToolSection.vue'

const { data, phase, error } = useSharedStream(tailscaleStream)
const endpoints = computed(() => (data.value ? toTailscaleEndpoints(data.value) : []))
</script>
```

`src/components/singbox/tools/TailscaleEndpoint.vue`：

```vue
<template>
  <div class="border-base-content/10 flex flex-col gap-3 rounded-xl border p-3">
    <div class="flex flex-wrap items-center gap-2">
      <span class="font-semibold">{{ endpoint.tag }}</span>
      <span class="badge badge-sm">{{ endpoint.backendState || '-' }}</span>
      <span class="text-base-content/60 text-xs">{{ endpoint.stateText }}</span>
      <div class="flex-1"></div>
      <button
        class="btn btn-sm"
        :class="confirmingLogout ? 'btn-error' : 'btn-ghost'"
        @click="onLogout"
      >
        {{ confirmingLogout ? $t('tailscaleConfirmLogout') : $t('tailscaleLogout') }}
      </button>
    </div>

    <div
      v-if="endpoint.authURL"
      class="flex flex-wrap items-center gap-3"
    >
      <div
        class="size-32 rounded bg-white p-1"
        v-html="qrCode"
      ></div>
      <a
        class="link link-primary break-all"
        :href="endpoint.authURL"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ $t('tailscaleLogin') }}
      </a>
    </div>

    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <StatCell
        :label="$t('tailscaleNetwork')"
        :value="endpoint.networkName || '-'"
      />
      <StatCell
        :label="$t('tailscaleMagicDNS')"
        :value="endpoint.magicDNSSuffix || '-'"
      />
      <StatCell
        :label="$t('tailscaleSelf')"
        :value="endpoint.self ? `${endpoint.self.hostName} ${endpoint.self.ips.join(', ')}` : '-'"
      />
    </div>

    <label class="flex flex-wrap items-center gap-2">
      <span class="text-base-content/60 text-xs">{{ $t('tailscaleExitNode') }}</span>
      <select
        class="select select-sm min-w-0 flex-1"
        :value="endpoint.exitNode?.stableID ?? ''"
        @change="onExitNode"
      >
        <option value="">{{ $t('tailscaleNoExitNode') }}</option>
        <option
          v-for="option in endpoint.exitNodeOptions"
          :key="option.stableID"
          :value="option.stableID"
        >
          {{ option.hostName }}
        </option>
      </select>
    </label>

    <div
      v-for="user in endpoint.users"
      :key="user.id"
      class="flex flex-col gap-1"
    >
      <div class="text-base-content/60 text-xs font-semibold">{{ user.name }}</div>
      <TailscalePeer
        v-for="peer in user.peers"
        :key="peer.stableID"
        :endpoint-tag="endpoint.tag"
        :peer="peer"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { toolErrorMessage } from '@/assembly/singbox/tools/common'
import {
  logoutTailscale,
  setTailscaleExitNode,
  type TailscaleEndpointView,
} from '@/assembly/singbox/tools/tailscale'
import { notifyRequestError } from '@/helper/request-error'
import { renderSVG } from 'uqr'
import { computed, ref } from 'vue'
import StatCell from './StatCell.vue'
import TailscalePeer from './TailscalePeer.vue'

const props = defineProps<{
  endpoint: TailscaleEndpointView
}>()

const confirmingLogout = ref(false)
const qrCode = computed(() => (props.endpoint.authURL ? renderSVG(props.endpoint.authURL) : ''))

const onExitNode = (event: Event) => {
  const stableID = (event.target as HTMLSelectElement).value

  setTailscaleExitNode(props.endpoint.tag, stableID).catch((e: unknown) =>
    notifyRequestError(new Error(toolErrorMessage(e))),
  )
}

const onLogout = () => {
  if (!confirmingLogout.value) {
    confirmingLogout.value = true
    setTimeout(() => (confirmingLogout.value = false), 3000)
    return
  }

  confirmingLogout.value = false
  logoutTailscale(props.endpoint.tag).catch((e: unknown) =>
    notifyRequestError(new Error(toolErrorMessage(e))),
  )
}
</script>
```

`src/components/singbox/tools/TailscalePeer.vue`：

```vue
<template>
  <div class="bg-base-200/30 flex flex-col gap-1 rounded-lg px-3 py-2">
    <div class="flex flex-wrap items-center gap-2">
      <span
        class="size-2 rounded-full"
        :class="peer.online ? 'bg-success' : 'bg-base-content/30'"
        :title="peer.online ? $t('tailscaleOnline') : $t('tailscaleOffline')"
      ></span>
      <span class="font-medium">{{ peer.hostName }}</span>
      <span class="text-base-content/60 text-xs">{{ peer.ips.join(', ') }}</span>
      <span
        v-if="peer.exitNode"
        class="badge badge-sm badge-primary"
        >{{ $t('tailscaleExitNode') }}</span
      >
      <div class="flex-1"></div>
      <span class="text-base-content/60 text-xs tabular-nums">
        ↓ {{ prettyBytesHelper(peer.rxBytes) }} ↑ {{ prettyBytesHelper(peer.txBytes) }}
      </span>
      <button
        class="btn btn-xs"
        :disabled="!peer.ips.length"
        @click="togglePing"
      >
        {{ run ? $t('tailscaleStopPing') : $t('tailscalePing') }}
      </button>
    </div>
    <div class="text-base-content/50 flex flex-wrap gap-3 text-xs">
      <span>{{ peer.os }}</span>
      <span v-if="peer.keyExpiry">
        {{ peer.expired ? $t('tailscaleExpired') : $t('tailscaleKeyExpiry') }}:
        {{ dayjs.unix(peer.keyExpiry).format('YYYY-MM-DD') }}
      </span>
    </div>
    <div
      v-if="latest"
      class="flex items-center gap-3 text-xs"
    >
      <span
        v-if="latest.error"
        class="text-error"
        >{{ latest.error }}</span
      >
      <template v-else>
        <span class="tabular-nums">{{ latest.latencyMs.toFixed(1) }} ms</span>
        <span class="text-base-content/60">
          {{
            latest.isDirect
              ? `${$t('tailscaleDirect')} ${latest.endpoint}`
              : $t('tailscaleRelay', { region: latest.derpRegionCode })
          }}
        </span>
      </template>
      <svg
        v-if="points"
        class="text-primary h-6 w-32"
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
      >
        <polyline
          :points="points"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        />
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { toolErrorMessage, type StreamingRun } from '@/assembly/singbox/tools/common'
import {
  PING_HISTORY,
  startTailscalePing,
  type TailscalePeerView,
  type TailscalePingSample,
} from '@/assembly/singbox/tools/tailscale'
import { prettyBytesHelper } from '@/helper/utils'
import dayjs from 'dayjs'
import { computed, onUnmounted, shallowRef } from 'vue'

const props = defineProps<{
  endpointTag: string
  peer: TailscalePeerView
}>()

const samples = shallowRef<TailscalePingSample[]>([])
const run = shallowRef<StreamingRun>()
const latest = computed(() => samples.value[samples.value.length - 1])

const points = computed(() => {
  const values = samples.value.filter((sample) => !sample.error).map((sample) => sample.latencyMs)

  if (values.length < 2) return ''

  const max = Math.max(...values) || 1

  return values
    .map((value, index) => `${(index / (values.length - 1)) * 100},${24 - (value / max) * 22}`)
    .join(' ')
})

const togglePing = () => {
  if (run.value) {
    run.value.cancel()
    return
  }

  samples.value = []

  const current = startTailscalePing(props.endpointTag, props.peer.ips[0], (sample) => {
    samples.value = [...samples.value, sample].slice(-PING_HISTORY)
  })

  run.value = current
  current.done
    .catch((e: unknown) => {
      samples.value = [
        ...samples.value,
        { latencyMs: 0, isDirect: false, endpoint: '', derpRegionCode: '', error: toolErrorMessage(e) },
      ]
    })
    .finally(() => {
      if (run.value === current) run.value = undefined
    })
}

onUnmounted(() => run.value?.cancel())
</script>
```

`src/views/ToolsPage.vue`：在 eBPF 卡片之后加 `<TailscaleCard v-if="can('tailscale')" />`，imports 加 `import TailscaleCard from '@/components/singbox/tools/TailscaleCard.vue'`。

- [ ] **Step 6: 文案**

| key | en | zh | zh-tw | ru |
|---|---|---|---|---|
| `tailscale` | `Tailscale` | `Tailscale` | `Tailscale` | `Tailscale` |
| `tailscaleLogin` | `Open sign-in page` | `打开登录页面` | `開啟登入頁面` | `Открыть страницу входа` |
| `tailscaleNetwork` | `Tailnet` | `Tailnet` | `Tailnet` | `Tailnet` |
| `tailscaleMagicDNS` | `MagicDNS` | `MagicDNS` | `MagicDNS` | `MagicDNS` |
| `tailscaleSelf` | `This device` | `本机` | `本機` | `Это устройство` |
| `tailscaleExitNode` | `Exit node` | `出口节点` | `出口節點` | `Выходной узел` |
| `tailscaleNoExitNode` | `None` | `不使用` | `不使用` | `Нет` |
| `tailscaleLogout` | `Log out` | `登出` | `登出` | `Выйти` |
| `tailscaleConfirmLogout` | `Click again to log out` | `再次点击以登出` | `再次點擊以登出` | `Нажмите ещё раз для выхода` |
| `tailscalePing` | `Ping` | `Ping` | `Ping` | `Ping` |
| `tailscaleStopPing` | `Stop` | `停止` | `停止` | `Стоп` |
| `tailscaleDirect` | `Direct` | `直连` | `直連` | `Напрямую` |
| `tailscaleRelay` | `DERP {region}` | `DERP 中继 {region}` | `DERP 中繼 {region}` | `DERP {region}` |
| `tailscaleOnline` | `Online` | `在线` | `在線` | `В сети` |
| `tailscaleOffline` | `Offline` | `离线` | `離線` | `Не в сети` |
| `tailscaleKeyExpiry` | `Key expires` | `密钥过期` | `金鑰到期` | `Ключ истекает` |
| `tailscaleExpired` | `Key expired` | `密钥已过期` | `金鑰已到期` | `Ключ истёк` |

- [ ] **Step 7: 全量检查并提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test && pnpm build
git add src/assembly/singbox/tools/tailscale.ts src/components/singbox/tools/Tailscale*.vue src/views/ToolsPage.vue src/i18n/singbox fork-test/singbox/api/tailscale.test.ts
git commit -m "feat(singbox): add Tailscale status, exit node, ping and logout to tools page"
```

---

### Task 16: OpenVPN 与 OpenConnect

**Files:**
- Create: `src/assembly/singbox/tools/vpn.ts`, `src/components/singbox/tools/OpenVPNCard.vue`, `src/components/singbox/tools/OpenConnectCard.vue`, `src/components/singbox/tools/VpnTunnel.vue`
- Modify: `src/views/ToolsPage.vue`, `src/i18n/singbox/*.ts`
- Test: `fork-test/singbox/api/vpn.test.ts`

**Interfaces:**
- Consumes: 同 Task 15。
- Produces:
  - `openVPNStream: SharedStream<OpenVPNStatusUpdate>`、`openConnectStream: SharedStream<OpenConnectStatusUpdate>`
  - `type VpnTunnelView = { server: string; addresses: string[]; dns: string[]; mtu: number; connectedSince: number; extra: { label: 'vpnCipher' | 'vpnTransport' | 'vpnNetwork'; value: string }[] }`
  - `type OpenVPNChallengeView = { id: string; kind: 'credentials' | 'secret' | 'message' | 'open-url' | 'unknown'; username: string; message: string; secretMessage: string; url: string; echo: boolean; previousError: string; deadline: number }`
  - `type OpenVPNEndpointView = { tag: string; state: string; stateText: string; error: string; tunnel?: VpnTunnelView; challenge?: OpenVPNChallengeView }`
  - `type OpenConnectField = { key: string; label: string; kind: 'text' | 'password' | 'select' | 'hidden'; value: string; options: { value: string; label: string }[] }`
  - `type OpenConnectChallengeView = { id: string; banner: string; message: string; error: string } & ({ type: 'form'; fields: OpenConnectField[] } | { type: 'browser'; url: string } | { type: 'none' })`
  - `type OpenConnectEndpointView = { tag: string; state: string; stateText: string; error: string; tunnel?: VpnTunnelView; challenge?: OpenConnectChallengeView }`
  - `toOpenVPNEndpoints(update)`、`toOpenConnectEndpoints(update)`、`initialFormValues(fields): Record<string, string>`
  - `submitOpenVPNChallenge(endpointTag, challengeID, response: { username?: string; password?: string; secret?: string })`、`cancelOpenVPNChallenge(endpointTag, challengeID)`、`submitOpenConnectForm(endpointTag, challengeID, values: Record<string, string>)`、`cancelOpenConnectChallenge(endpointTag, challengeID)`

- [ ] **Step 1: 写失败的测试**

`fork-test/singbox/api/vpn.test.ts`：

```ts
import {
  OpenConnectStatusUpdateSchema,
  OpenVPNStatusUpdateSchema,
} from '@/assembly/singbox/api/gen/daemon/started_service_pb'
import {
  initialFormValues,
  toOpenConnectEndpoints,
  toOpenVPNEndpoints,
} from '@/assembly/singbox/tools/vpn'
import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'

describe('OpenVPN', () => {
  it('maps tunnel and credential challenge', () => {
    const [endpoint] = toOpenVPNEndpoints(
      create(OpenVPNStatusUpdateSchema, {
        endpoints: [
          {
            endpointTag: 'ovpn',
            state: 'connected',
            tunnelInfo: {
              server: 'vpn.example.com:1194',
              network: 'udp',
              ipv4: ['10.8.0.2/24'],
              ipv6: ['fd00::2/64'],
              dns: ['10.8.0.1'],
              mtu: 1500,
              connectedSince: 1_700_000_000n,
              cipher: 'AES-256-GCM',
            },
            challenge: { id: 'c1', kind: 'credentials', username: 'alice', deadline: 5n },
          },
        ],
      }),
    )

    expect(endpoint.tunnel?.addresses).toEqual(['10.8.0.2/24', 'fd00::2/64'])
    expect(endpoint.tunnel?.connectedSince).toBe(1_700_000_000)
    expect(endpoint.tunnel?.extra).toEqual([
      { label: 'vpnNetwork', value: 'udp' },
      { label: 'vpnCipher', value: 'AES-256-GCM' },
    ])
    expect(endpoint.challenge).toMatchObject({ id: 'c1', kind: 'credentials', username: 'alice', deadline: 5 })
  })

  it('marks unknown challenge kinds', () => {
    const [endpoint] = toOpenVPNEndpoints(
      create(OpenVPNStatusUpdateSchema, { endpoints: [{ endpointTag: 'o', challenge: { id: 'x', kind: 'weird' } }] }),
    )

    expect(endpoint.challenge?.kind).toBe('unknown')
    expect(endpoint.tunnel).toBeUndefined()
  })
})

describe('OpenConnect', () => {
  it('maps form and browser challenges', () => {
    const [form, browser] = toOpenConnectEndpoints(
      create(OpenConnectStatusUpdateSchema, {
        endpoints: [
          {
            endpointTag: 'oc1',
            authChallenge: {
              id: 'f',
              message: 'Login',
              challenge: {
                case: 'form',
                value: {
                  fields: [
                    { submissionKey: 'user', name: 'username', label: 'User', kind: 'text', value: 'bob' },
                    { name: 'group', label: 'Group', kind: 'select', options: [{ value: 'a', label: 'A' }] },
                    { name: 'csrf', kind: 'hidden', value: 't0k' },
                    { name: 'otp', label: 'OTP', kind: 'weird' },
                  ],
                },
              },
            },
          },
          {
            endpointTag: 'oc2',
            authChallenge: { id: 'b', challenge: { case: 'browser', value: { url: 'https://sso.example.com' } } },
          },
        ],
      }),
    )

    const challenge = form.challenge
    expect(challenge?.type).toBe('form')
    if (challenge?.type !== 'form') return
    expect(challenge.fields.map((field) => [field.key, field.kind])).toEqual([
      ['user', 'text'],
      ['group', 'select'],
      ['csrf', 'hidden'],
      ['otp', 'text'],
    ])
    expect(initialFormValues(challenge.fields)).toEqual({ user: 'bob', group: 'a', csrf: 't0k', otp: '' })
    expect(browser.challenge).toMatchObject({ type: 'browser', url: 'https://sso.example.com' })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm -C fork-test exec vitest run singbox/api/vpn.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 vpn.ts**

```ts
import { api, serverStream } from '../api/client'
import {
  StartedService,
  type OpenConnectAuthChallenge,
  type OpenConnectStatusUpdate,
  type OpenConnectTunnelInfo,
  type OpenVPNChallenge,
  type OpenVPNStatusUpdate,
  type OpenVPNTunnelInfo,
} from '../api/gen/daemon/started_service_pb'
import { createSharedStream } from '../api/stream'

export type VpnTunnelView = {
  server: string
  addresses: string[]
  dns: string[]
  mtu: number
  connectedSince: number
  extra: { label: 'vpnCipher' | 'vpnTransport' | 'vpnNetwork'; value: string }[]
}

export type OpenVPNChallengeView = {
  id: string
  kind: 'credentials' | 'secret' | 'message' | 'open-url' | 'unknown'
  username: string
  message: string
  secretMessage: string
  url: string
  echo: boolean
  previousError: string
  deadline: number
}

export type OpenVPNEndpointView = {
  tag: string
  state: string
  stateText: string
  error: string
  tunnel?: VpnTunnelView
  challenge?: OpenVPNChallengeView
}

export type OpenConnectField = {
  key: string
  label: string
  kind: 'text' | 'password' | 'select' | 'hidden'
  value: string
  options: { value: string; label: string }[]
}

export type OpenConnectChallengeView = {
  id: string
  banner: string
  message: string
  error: string
} & (
  | { type: 'form'; fields: OpenConnectField[] }
  | { type: 'browser'; url: string }
  | { type: 'none' }
)

export type OpenConnectEndpointView = {
  tag: string
  state: string
  stateText: string
  error: string
  tunnel?: VpnTunnelView
  challenge?: OpenConnectChallengeView
}

const OPENVPN_KINDS = new Set(['credentials', 'secret', 'message', 'open-url'])
const FIELD_KINDS = new Set(['text', 'password', 'select', 'hidden'])

export const openVPNStream = createSharedStream((signal) =>
  serverStream(StartedService.method.subscribeOpenVPNStatus, {}, signal),
)

export const openConnectStream = createSharedStream((signal) =>
  serverStream(StartedService.method.subscribeOpenConnectStatus, {}, signal),
)

const toTunnel = (
  info: OpenVPNTunnelInfo | OpenConnectTunnelInfo,
  extra: VpnTunnelView['extra'],
): VpnTunnelView => ({
  server: info.server,
  addresses: [...info.ipv4, ...info.ipv6],
  dns: [...info.dns],
  mtu: info.mtu,
  connectedSince: Number(info.connectedSince),
  extra: extra.filter((item) => item.value),
})

const toOpenVPNChallenge = (challenge: OpenVPNChallenge): OpenVPNChallengeView => ({
  id: challenge.id,
  kind: OPENVPN_KINDS.has(challenge.kind)
    ? (challenge.kind as OpenVPNChallengeView['kind'])
    : 'unknown',
  username: challenge.username,
  message: challenge.message,
  secretMessage: challenge.secretMessage,
  url: challenge.url,
  echo: challenge.echo,
  previousError: challenge.previousError,
  deadline: Number(challenge.deadline),
})

export const toOpenVPNEndpoints = (update: OpenVPNStatusUpdate): OpenVPNEndpointView[] =>
  update.endpoints.map((endpoint) => ({
    tag: endpoint.endpointTag,
    state: endpoint.state,
    stateText: endpoint.stateText,
    error: endpoint.error,
    tunnel: endpoint.tunnelInfo
      ? toTunnel(endpoint.tunnelInfo, [
          { label: 'vpnNetwork', value: endpoint.tunnelInfo.network },
          { label: 'vpnCipher', value: endpoint.tunnelInfo.cipher },
        ])
      : undefined,
    challenge: endpoint.challenge ? toOpenVPNChallenge(endpoint.challenge) : undefined,
  }))

const toOpenConnectChallenge = (challenge: OpenConnectAuthChallenge): OpenConnectChallengeView => {
  const base = {
    id: challenge.id,
    banner: challenge.banner,
    message: challenge.message,
    error: challenge.error,
  }

  if (challenge.challenge.case === 'form') {
    return {
      ...base,
      type: 'form',
      fields: challenge.challenge.value.fields.map((field) => ({
        key: field.submissionKey || field.name,
        label: field.label || field.name,
        kind: FIELD_KINDS.has(field.kind) ? (field.kind as OpenConnectField['kind']) : 'text',
        value: field.value,
        options: field.options.map((option) => ({ value: option.value, label: option.label })),
      })),
    }
  }

  if (challenge.challenge.case === 'browser') {
    return { ...base, type: 'browser', url: challenge.challenge.value.url }
  }

  return { ...base, type: 'none' }
}

export const toOpenConnectEndpoints = (
  update: OpenConnectStatusUpdate,
): OpenConnectEndpointView[] =>
  update.endpoints.map((endpoint) => ({
    tag: endpoint.endpointTag,
    state: endpoint.state,
    stateText: endpoint.stateText,
    error: endpoint.error,
    tunnel: endpoint.tunnelInfo
      ? toTunnel(endpoint.tunnelInfo, [
          { label: 'vpnTransport', value: endpoint.tunnelInfo.transport },
        ])
      : undefined,
    challenge: endpoint.authChallenge ? toOpenConnectChallenge(endpoint.authChallenge) : undefined,
  }))

export const initialFormValues = (fields: OpenConnectField[]) =>
  Object.fromEntries(
    fields.map((field) => [
      field.key,
      field.value || (field.kind === 'select' ? (field.options[0]?.value ?? '') : ''),
    ]),
  )

export const submitOpenVPNChallenge = async (
  endpointTag: string,
  challengeID: string,
  response: { username?: string; password?: string; secret?: string },
) => {
  await api().submitOpenVPNChallengeResponse({ endpointTag, challengeID, ...response })
}

export const cancelOpenVPNChallenge = async (endpointTag: string, challengeID: string) => {
  await api().cancelOpenVPNChallenge({ endpointTag, challengeID })
}

export const submitOpenConnectForm = async (
  endpointTag: string,
  challengeID: string,
  values: Record<string, string>,
) => {
  await api().submitOpenConnectAuthResponse({
    endpointTag,
    challengeID,
    response: { case: 'form', value: { values } },
  })
}

export const cancelOpenConnectChallenge = async (endpointTag: string, challengeID: string) => {
  await api().cancelOpenConnectAuthChallenge({ endpointTag, challengeID })
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm -C fork-test exec vitest run singbox/api/vpn.test.ts`
Expected: PASS。

- [ ] **Step 5: 组件**

`src/components/singbox/tools/VpnTunnel.vue`：

```vue
<template>
  <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
    <StatCell
      :label="$t('vpnServer')"
      :value="tunnel.server || '-'"
    />
    <StatCell
      :label="$t('vpnAddresses')"
      :value="tunnel.addresses.join(', ') || '-'"
    />
    <StatCell
      :label="$t('vpnDns')"
      :value="tunnel.dns.join(', ') || '-'"
    />
    <StatCell
      :label="$t('vpnMtu')"
      :value="String(tunnel.mtu || '-')"
    />
    <StatCell
      :label="$t('vpnConnectedSince')"
      :value="
        tunnel.connectedSince
          ? dayjs.unix(tunnel.connectedSince).format('YYYY-MM-DD HH:mm:ss')
          : '-'
      "
    />
    <StatCell
      v-for="item in tunnel.extra"
      :key="item.label"
      :label="$t(item.label)"
      :value="item.value"
    />
  </div>
</template>

<script setup lang="ts">
import type { VpnTunnelView } from '@/assembly/singbox/tools/vpn'
import dayjs from 'dayjs'
import StatCell from './StatCell.vue'

defineProps<{
  tunnel: VpnTunnelView
}>()
</script>
```

`connectedSince` 是 Unix 秒（`daemon/started_service.go` 里用 `ConnectedSince.Unix()`），所以用 `dayjs.unix`。

`src/components/singbox/tools/OpenVPNCard.vue`：

```vue
<template>
  <ToolSection
    :title="$t('openvpn')"
    :empty="phase === 'active' && endpoints.length === 0"
  >
    <div
      v-for="endpoint in endpoints"
      :key="endpoint.tag"
      class="border-base-content/10 flex flex-col gap-3 rounded-xl border p-3"
    >
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-semibold">{{ endpoint.tag }}</span>
        <span class="badge badge-sm">{{ endpoint.state || '-' }}</span>
        <span class="text-base-content/60 text-xs">{{ endpoint.stateText }}</span>
      </div>
      <div
        v-if="endpoint.error"
        class="text-error text-xs"
      >
        {{ endpoint.error }}
      </div>
      <VpnTunnel
        v-if="endpoint.tunnel"
        :tunnel="endpoint.tunnel"
      />
      <form
        v-if="endpoint.challenge"
        class="bg-base-200/30 flex flex-col gap-2 rounded-xl p-3"
        @submit.prevent="submit(endpoint.tag, endpoint.challenge)"
      >
        <div class="font-medium">{{ $t('vpnChallenge') }}</div>
        <div
          v-if="endpoint.challenge.message"
          class="text-xs whitespace-pre-wrap"
        >
          {{ endpoint.challenge.message }}
        </div>
        <div
          v-if="endpoint.challenge.previousError"
          class="text-error text-xs"
        >
          {{ endpoint.challenge.previousError }}
        </div>
        <template v-if="endpoint.challenge.kind === 'credentials'">
          <input
            v-model="form.username"
            class="input input-sm"
            autocomplete="username"
            :placeholder="$t('vpnUsername')"
          />
          <input
            v-model="form.password"
            type="password"
            class="input input-sm"
            autocomplete="current-password"
            :placeholder="$t('vpnPassword')"
          />
        </template>
        <input
          v-if="
            endpoint.challenge.kind === 'secret' ||
            (endpoint.challenge.kind === 'credentials' && endpoint.challenge.secretMessage)
          "
          v-model="form.secret"
          :type="endpoint.challenge.echo ? 'text' : 'password'"
          class="input input-sm"
          autocomplete="one-time-code"
          :placeholder="endpoint.challenge.secretMessage || $t('vpnSecret')"
        />
        <a
          v-if="endpoint.challenge.kind === 'open-url' && endpoint.challenge.url"
          class="link link-primary break-all"
          :href="endpoint.challenge.url"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ $t('vpnOpenUrl') }}
        </a>
        <div class="flex gap-2">
          <button
            v-if="endpoint.challenge.kind === 'credentials' || endpoint.challenge.kind === 'secret'"
            type="submit"
            class="btn btn-sm btn-primary"
          >
            {{ $t('vpnSubmit') }}
          </button>
          <button
            type="button"
            class="btn btn-sm"
            @click="cancel(endpoint.tag, endpoint.challenge.id)"
          >
            {{ $t('vpnCancelChallenge') }}
          </button>
        </div>
      </form>
    </div>
    <div
      v-if="error"
      class="text-error text-sm"
    >
      {{ toolErrorMessage(error) }}
    </div>
  </ToolSection>
</template>

<script setup lang="ts">
import { toolErrorMessage, useSharedStream } from '@/assembly/singbox/tools/common'
import {
  cancelOpenVPNChallenge,
  openVPNStream,
  submitOpenVPNChallenge,
  toOpenVPNEndpoints,
  type OpenVPNChallengeView,
} from '@/assembly/singbox/tools/vpn'
import { notifyRequestError } from '@/helper/request-error'
import { computed, reactive, watch } from 'vue'
import ToolSection from './ToolSection.vue'
import VpnTunnel from './VpnTunnel.vue'

const { data, phase, error } = useSharedStream(openVPNStream)
const endpoints = computed(() => (data.value ? toOpenVPNEndpoints(data.value) : []))
const form = reactive({ username: '', password: '', secret: '' })

watch(
  () => endpoints.value.map((endpoint) => endpoint.challenge?.id).join(','),
  () => {
    const challenge = endpoints.value.find((endpoint) => endpoint.challenge)?.challenge

    form.username = challenge?.username ?? ''
    form.password = ''
    form.secret = ''
  },
)

const report = (e: unknown) => notifyRequestError(new Error(toolErrorMessage(e)))

const submit = (tag: string, challenge: OpenVPNChallengeView) => {
  const response =
    challenge.kind === 'secret'
      ? { secret: form.secret }
      : { username: form.username, password: form.password, secret: form.secret }

  submitOpenVPNChallenge(tag, challenge.id, response).catch(report)
}

const cancel = (tag: string, id: string) => {
  cancelOpenVPNChallenge(tag, id).catch(report)
}
</script>
```

`src/components/singbox/tools/OpenConnectCard.vue`：

```vue
<template>
  <ToolSection
    :title="$t('openconnect')"
    :empty="phase === 'active' && endpoints.length === 0"
  >
    <div
      v-for="endpoint in endpoints"
      :key="endpoint.tag"
      class="border-base-content/10 flex flex-col gap-3 rounded-xl border p-3"
    >
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-semibold">{{ endpoint.tag }}</span>
        <span class="badge badge-sm">{{ endpoint.state || '-' }}</span>
        <span class="text-base-content/60 text-xs">{{ endpoint.stateText }}</span>
      </div>
      <div
        v-if="endpoint.error"
        class="text-error text-xs"
      >
        {{ endpoint.error }}
      </div>
      <VpnTunnel
        v-if="endpoint.tunnel"
        :tunnel="endpoint.tunnel"
      />
      <form
        v-if="endpoint.challenge"
        class="bg-base-200/30 flex flex-col gap-2 rounded-xl p-3"
        @submit.prevent="submit(endpoint.tag, endpoint.challenge.id)"
      >
        <div class="font-medium">{{ $t('vpnChallenge') }}</div>
        <div
          v-if="endpoint.challenge.banner"
          class="text-xs whitespace-pre-wrap"
        >
          {{ endpoint.challenge.banner }}
        </div>
        <div
          v-if="endpoint.challenge.message"
          class="text-xs whitespace-pre-wrap"
        >
          {{ endpoint.challenge.message }}
        </div>
        <div
          v-if="endpoint.challenge.error"
          class="text-error text-xs"
        >
          {{ endpoint.challenge.error }}
        </div>
        <template v-if="endpoint.challenge.type === 'form'">
          <template
            v-for="field in endpoint.challenge.fields"
            :key="field.key"
          >
            <select
              v-if="field.kind === 'select'"
              v-model="values[field.key]"
              class="select select-sm"
            >
              <option
                v-for="option in field.options"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
            <input
              v-else-if="field.kind !== 'hidden'"
              v-model="values[field.key]"
              :type="field.kind"
              class="input input-sm"
              :placeholder="field.label"
            />
          </template>
        </template>
        <template v-else-if="endpoint.challenge.type === 'browser'">
          <a
            class="link link-primary break-all"
            :href="endpoint.challenge.url"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ endpoint.challenge.url }}
          </a>
          <div class="text-base-content/60 text-xs">{{ $t('vpnBrowserUnsupported') }}</div>
        </template>
        <div class="flex gap-2">
          <button
            v-if="endpoint.challenge.type === 'form'"
            type="submit"
            class="btn btn-sm btn-primary"
          >
            {{ $t('vpnSubmit') }}
          </button>
          <button
            type="button"
            class="btn btn-sm"
            @click="cancel(endpoint.tag, endpoint.challenge.id)"
          >
            {{ $t('vpnCancelChallenge') }}
          </button>
        </div>
      </form>
    </div>
    <div
      v-if="error"
      class="text-error text-sm"
    >
      {{ toolErrorMessage(error) }}
    </div>
  </ToolSection>
</template>

<script setup lang="ts">
import { toolErrorMessage, useSharedStream } from '@/assembly/singbox/tools/common'
import {
  cancelOpenConnectChallenge,
  initialFormValues,
  openConnectStream,
  submitOpenConnectForm,
  toOpenConnectEndpoints,
} from '@/assembly/singbox/tools/vpn'
import { notifyRequestError } from '@/helper/request-error'
import { computed, ref, watch } from 'vue'
import ToolSection from './ToolSection.vue'
import VpnTunnel from './VpnTunnel.vue'

const { data, phase, error } = useSharedStream(openConnectStream)
const endpoints = computed(() => (data.value ? toOpenConnectEndpoints(data.value) : []))
const values = ref<Record<string, string>>({})

watch(
  () => endpoints.value.map((endpoint) => endpoint.challenge?.id).join(','),
  () => {
    const challenge = endpoints.value.find(
      (endpoint) => endpoint.challenge?.type === 'form',
    )?.challenge

    values.value = challenge?.type === 'form' ? initialFormValues(challenge.fields) : {}
  },
)

const report = (e: unknown) => notifyRequestError(new Error(toolErrorMessage(e)))

const submit = (tag: string, id: string) => {
  submitOpenConnectForm(tag, id, { ...values.value }).catch(report)
}

const cancel = (tag: string, id: string) => {
  cancelOpenConnectChallenge(tag, id).catch(report)
}
</script>
```

两个卡片都假设同一时刻最多一个 endpoint 处于认证挑战中（表单状态按“第一个带挑战的 endpoint”初始化），这与 sing-box 的实际使用一致；多个 endpoint 同时挑战时，表单值会共用，提交前用户可以逐个修改。

`src/views/ToolsPage.vue`：在 Tailscale 卡片之后加

```vue
      <OpenVPNCard v-if="can('openvpn')" />
      <OpenConnectCard v-if="can('openconnect')" />
```

imports 加 `import OpenConnectCard from '@/components/singbox/tools/OpenConnectCard.vue'` 与 `import OpenVPNCard from '@/components/singbox/tools/OpenVPNCard.vue'`。

- [ ] **Step 6: 文案**

| key | en | zh | zh-tw | ru |
|---|---|---|---|---|
| `openvpn` | `OpenVPN` | `OpenVPN` | `OpenVPN` | `OpenVPN` |
| `openconnect` | `OpenConnect` | `OpenConnect` | `OpenConnect` | `OpenConnect` |
| `vpnServer` | `Server` | `服务器` | `伺服器` | `Сервер` |
| `vpnAddresses` | `Addresses` | `地址` | `位址` | `Адреса` |
| `vpnDns` | `DNS` | `DNS` | `DNS` | `DNS` |
| `vpnMtu` | `MTU` | `MTU` | `MTU` | `MTU` |
| `vpnConnectedSince` | `Connected since` | `连接时间` | `連接時間` | `Подключено с` |
| `vpnCipher` | `Cipher` | `加密算法` | `加密演算法` | `Шифр` |
| `vpnTransport` | `Transport` | `传输` | `傳輸` | `Транспорт` |
| `vpnNetwork` | `Network` | `网络` | `網路` | `Сеть` |
| `vpnChallenge` | `Authentication required` | `需要认证` | `需要認證` | `Требуется аутентификация` |
| `vpnUsername` | `Username` | `用户名` | `使用者名稱` | `Имя пользователя` |
| `vpnPassword` | `Password` | `密码` | `密碼` | `Пароль` |
| `vpnSecret` | `Secret` | `验证码` | `驗證碼` | `Код` |
| `vpnSubmit` | `Submit` | `提交` | `提交` | `Отправить` |
| `vpnCancelChallenge` | `Cancel` | `取消` | `取消` | `Отмена` |
| `vpnOpenUrl` | `Open authentication page` | `打开认证页面` | `開啟認證頁面` | `Открыть страницу аутентификации` |
| `vpnBrowserUnsupported` | `Browser sign-in has to be completed in a sing-box client` | `浏览器登录需要在 sing-box 客户端中完成` | `瀏覽器登入需要在 sing-box 用戶端中完成` | `Вход через браузер нужно завершить в клиенте sing-box` |

- [ ] **Step 7: 全量检查并提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test && pnpm build
git add src/assembly/singbox/tools/vpn.ts src/components/singbox/tools/OpenVPNCard.vue src/components/singbox/tools/OpenConnectCard.vue src/components/singbox/tools/VpnTunnel.vue src/views/ToolsPage.vue src/i18n/singbox fork-test/singbox/api/vpn.test.ts
git commit -m "feat(singbox): add OpenVPN and OpenConnect status and challenges to tools page"
```

---

### Task 17: 冒烟 mock 与端到端验证

**Files:**
- Create: `fork-test/mock-singbox-api.mjs`
- Modify: `fork-test/package.json`（devDependencies 加 `ws`）, `fork-test/pnpm-lock.yaml`, `FORK.md`（测试一节加冒烟说明）, `CLAUDE.md`（冒烟一节加一行）

**Interfaces:**
- Consumes: 全部前序任务。
- Produces: `node fork-test/mock-singbox-api.mjs --port 19999 --upstream 19998`：同端口提供 gRPC-Web 一元调用与 grpc-websockets 流，其余请求反向代理到 `test/mock-server.mjs`。

- [ ] **Step 1: 加依赖**

```bash
pnpm -C fork-test add -D ws@^8
```

- [ ] **Step 2: 编写 mock**

`fork-test/mock-singbox-api.mjs`：

```js
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
      `${ESC}[${colors[level]}m${labels[level]}${ESC}[0m[${seconds}] [${ESC}[38;5;208m${3000 + logSeq} 5ms${ESC}[0m] dns: exchanged example.com from 172.19.0.2:53`,
    ),
  ]
}
const logMessage = (lines, reset = false) => [
  ...lines.flatMap((line) => msg(1, line)),
  ...bool(2, reset),
]

const groups = (selected) =>
  msg(
    1,
    [
      ...str(1, 'proxy'),
      ...str(2, 'selector'),
      ...bool(3, true),
      ...str(4, selected),
      ...msg(6, [...str(1, 'node-a'), ...str(2, 'vless'), ...int(3, 1), ...int(4, 120)]),
      ...msg(6, [...str(1, 'node-b'), ...str(2, 'vless'), ...int(3, 1), ...int(4, 180)]),
    ],
  )

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

const unary = {
  GetVersion: version,
  GetStartedAt: () => int(1, startedAt),
  CloseConnection: () => [],
  CloseAllConnections: () => [],
  SetTailscaleExitNode: () => [],
  TailscaleLogout: () => [],
  ClearLogs: () => [],
}

const streams = {
  SubscribeStatus: (send) => {
    send(status())
    return setInterval(() => send(status()), 1000)
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
    send(logMessage([logLine(4, 'hello'), logLine(5, 'debug'), logLine(3, 'warn')], true))
    return setInterval(() => send(logMessage([logLine(4, 'tick')])), 2000)
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
  SubscribeOpenVPNStatus: (send) => {
    send([])
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
    { host: '127.0.0.1', port: args.upstream, path: req.url, method: req.method, headers: req.headers },
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

const server = http.createServer((req, res) => {
  const method = methodOf(req.url)

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

    ws.on('message', (data) => {
      const chunk = Buffer.from(data)
      if (started || chunk[0] !== 0) return
      started = true

      const handler = streams[method]
      if (!handler) {
        ws.send(trailerFrame(12, `${method} not mocked`))
        ws.close()
        return
      }

      ws.send(frame(0x80, [...Buffer.from('content-type: application/grpc-web+proto\r\n')]))
      timer = handler((body) => {
        if (ws.readyState === ws.OPEN) ws.send(dataFrame(body))
      })
    })
    ws.on('close', () => clearInterval(timer))
  })
})

server.listen(Number(args.port), () => {
  console.log(`mock sing-box API on :${args.port}, proxying Clash API to :${args.upstream}`)
})
```

- [ ] **Step 3: 启动冒烟环境**

```bash
node test/mock-server.mjs --port 19998 --version 'sing-box 1.15.0-alpha.6-reF1nd-moonfruit.2' &
node fork-test/mock-singbox-api.mjs --port 19999 --upstream 19998 &
pnpm dev
```

浏览器打开 `http://localhost:5173/?hostname=127.0.0.1&port=19999`，逐项确认：

1. 设置 → 后端：状态行显示“sing-box API：已连接（API 版本 5）”。
2. 概览：流量图每秒更新；「sing-box 运行状态」卡片显示运行时长约 1 小时 2 分并逐秒增长、goroutines 123。
3. 连接：`c1`、`c2` 在活跃列表，`old` 一打开就在已关闭列表；`c1` 下行速率约 50 KB/s 且不闪 0；每 5 秒出现新连接，3 秒后移入已关闭；列设置里有「入站 / 来源出站 / 出站类型 / 协议」，没有「嗅探域名」。
4. 日志：首屏有 hello / warn（debug 被 info 级过滤），级别标签与 `[3001 5ms]` 带颜色；搜索 `dns` 时高亮与颜色同时正确；源 IP 标签替换后颜色不乱。
5. 代理：15 秒后组 `proxy` 的选中项自动在 node-a / node-b 之间切换。
6. 工具 tab 出现；Tailscale 区块显示 3 个节点，gateway 可选为出口节点，Ping 显示延迟和 sparkline；OpenVPN / OpenConnect 区块显示“未配置”；网络质量与 STUN 在 mock 下返回“not mocked”错误并显示在卡片内。
7. 关闭 `mock-singbox-api.mjs` 再重启：状态保持，流在 5 秒内自动恢复，日志不重复。
8. 切换到一个 mihomo 后端（`node test/mock-server.mjs --port 19997` 后添加）：工具 tab 消失，若停留在工具页则跳回代理页。

发现问题时回到对应任务修复并补测试，不在本任务里打补丁。

- [ ] **Step 4: 真实 moonfruit sing-box 端到端**

请用户提供一台运行 moonfruit 版 sing-box 的环境，配置示例：

```json
{
  "experimental": { "clash_api": { "external_controller": "127.0.0.1:9090", "secret": "s" } },
  "services": [{ "type": "api", "listen": "127.0.0.1", "listen_port": 9090, "secret": "s" }]
}
```

重复 Step 3 的 1–7，并额外确认：网络质量与 STUN 能跑完；执行“重载配置”后所有流自动恢复。把 API service 的 secret 改成与 Clash 不同，确认面板退回 Clash 并显示“未授权”。

- [ ] **Step 5: 文档**

`FORK.md` 的「测试」一节末尾加：

```markdown
sing-box API 冒烟：`node test/mock-server.mjs --port 19998 --version 'sing-box 1.15.0-alpha.6-reF1nd-moonfruit.2'` 与 `node fork-test/mock-singbox-api.mjs --port 19999 --upstream 19998`，面板连 `127.0.0.1:19999`。
```

`CLAUDE.md` 的「上游的冒烟脚本」一节末尾加同样一行。

- [ ] **Step 6: 最终检查并提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm build
pnpm -C fork-test type-check && pnpm -C fork-test test
pnpm -C fork-proto generate && git diff --exit-code -- src/assembly/singbox/api/gen
rg -l "grpc-websockets" dist/assets/index-*.js || echo "main chunk clean"
git add fork-test/mock-singbox-api.mjs fork-test/package.json fork-test/pnpm-lock.yaml FORK.md CLAUDE.md
git commit -m "test(singbox): add sing-box API mock for smoke testing"
```
