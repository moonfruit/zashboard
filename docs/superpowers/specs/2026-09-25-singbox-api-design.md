# 接入 sing-box API（moonfruit 变体）设计

- 日期：2026-09-25
- 分支：`feat/sing-box-grpc`（自 `moonfruit` 拉出）
- 性质：moonfruit fork 长期维护的自有特性，承接 `2026-09-24-singbox-restore-design.md` 预留的 gRPC 接入口
- 依据：本地 sing-box 源码（`/Users/moon/Workspace.localized/go/mod/sing-box`，`moonfruit` / `origin/testing` / `ref1nd/reF1nd-testing` 三个 ref）、上游已删除的原生 sing-box 实现（`4adb4872^`）、SagerNet/sing-box-dashboard（GPL-3.0，只借鉴设计，不复制代码）

## 背景与目标

sing-box 1.14 起提供 API service（`service/api`，`"type": "api"`），对外只暴露一个 gRPC 服务 `daemon.StartedService`，浏览器可以通过 gRPC-Web 或 grpc-websockets 调用。moonfruit 分支的 `e8567f285` 让 API service 与 `experimental.clash_api.external_controller` 在同一地址端口上共用监听：路径以 `/daemon.` 开头、`/dashboard`、`/observability/v1`、gRPC WebSocket 升级以及 `Content-Type: application/grpc*` 的请求交给 API service，其余交给 Clash。两边的 secret 和 CORS 各自独立。

目标：

1. 后端为 clash、内核为 sing-box、变体为 moonfruit，且同一端口上的 API service 可用时，把 Clash API 中已有、且 sing-box API 更有价值的功能改走 sing-box API。
2. 适配 sing-box 专有功能：概览增强、诊断工具（网络质量、STUN、eBPF）、Tailscale 基础功能、OpenVPN 和 OpenConnect 认证挑战。日志的 ANSI 颜色转换成对应的显示颜色。
3. 专有功能统一放在新的「工具」tab；与现有页面天然相关的增强留在原页面。

非目标：

- 不支持独立地址的 API service，官方和 ref1nd 分开监听的部署不接入。不新增 `BackendType`，也不改后端表单。
- 不做 observability（Top-K、Prometheus、SSE），留待后续。
- 不做需要双向流的功能：Tailscale SSH、Taildrop（收件箱和发送）、Tailscale 证书、USB/IP。
- 不做 `SubscribeNotifications`、`GetDeprecatedWarnings`（attached 模式下总是空）、`SetGroupExpand`。
- 不在运行中自动从 Clash 升级到 API（探测失败后的一次重试除外，见「识别与启用」）。常驻流遇到终止错误时自动退回 Clash（Unauthenticated/PermissionDenied 会从探测开始重启会话；其余终止错误在后端变化或刷新页面前不再探测该后端）。

## 设计约束

- 沿用 fork 约定：新逻辑放新文件，上游文件只加最少的挂接点，不格式化、不重构上游代码，不写注释。
- 视图层只通过 `can()` 和 assembly 门面访问数据，不导入 client 或生成代码（遵守 eslint 分层规则）。
- 纯 Clash 用户的主 chunk 体积不变：gRPC client 和工具页都懒加载。

## 功能取舍：Clash API 与 sing-box API 对照

| 功能 | Clash API | sing-box API | 选用 |
|---|---|---|---|
| 流量、内存 | `/traffic`、`/memory` 两条 WS | `SubscribeStatus`：一条流包含速率、累计值、内存、goroutines、进出连接数 | **API** |
| 连接 | `/connections` WS，每次推全量 | `SubscribeConnections`：增量事件，首帧带最近已关闭的连接，字段更多 | **API** |
| 关闭连接 | `DELETE /connections[/id]` | `CloseConnection`、`CloseAllConnections` | **API**，与连接数据源保持一致 |
| 日志 | `/logs?level=` WS | `SubscribeLog`：首帧带 3000 行积压，批量推送，带 ANSI 颜色 | **API** |
| 代理列表、选择 | `/proxies` 带 GLOBAL、udp、history、provider | `SubscribeGroups`：推送式，但字段少 | 数据仍取 **Clash**；API 的 Groups 流只作变化通知 |
| 延迟测试 | 可指定 url 和 timeout，同步返回结果 | `URLTest`：不能指定参数，发出即返回，结果从推送里取 | **Clash** |
| 模式 | `/configs` 的 mode 和 `mode-list`，PATCH 修改 | `SubscribeClashMode` 推送 | 数据和修改走 **Clash**；API 的 ClashMode 流只作变化通知 |
| 规则、providers、DNS 查询、FakeIP/DNS 清理、重载、重启 | 有 | 无 | **Clash** |
| 运行时长、goroutines、网络质量、STUN、eBPF、Tailscale、OpenVPN、OpenConnect | 无 | 有 | **API** |

## 识别与启用

1. `probeBackendVersion`（`assembly/version.ts`）照常通过 Clash `/version` 判定 core 和 variant。
2. 当 `core === Singbox` 且 `variant === 'moonfruit'` 时，调用新增的 `probeSingboxApi(backend)`：
   - 动态加载 `assembly/singbox/api/client.ts`；
   - 通过 gRPC-Web 一元调用 `GetVersion`，超时 3s；
   - baseUrl 是 `${protocol}://${host}:${port}`，不带 `secondaryPath`；后端配置了 `secondaryPath`（反向代理子路径）时不探测，直接记为 `subpath`；
   - 鉴权是 `Authorization: Bearer <backend.password>`，另外带上 `Accept-Language`。
3. 成功时写入 `singboxApi = { apiVersion, version }`，失败时写入 `singboxApiError`，取值为 `'unauthorized' | 'unimplemented' | 'network' | 'timeout' | 'subpath'`。`ConnectError` 的 Code 映射为：
   - Unauthenticated、PermissionDenied → unauthorized
   - Unimplemented、NotFound → unimplemented
   - DeadlineExceeded → timeout
   - 其余 → network
4. `resetCore` 同时清空 `singboxApi` 和 `singboxApiError`。
5. 每次探测递增一个代号，结果回来时代号已变（有更新的探测）或当前后端已变都丢弃。
6. 失败原因是 `timeout` 或 `network` 时，3s 后重试一次（仍需同一后端、没有更新的探测）。重试成功就写入 API 状态，并通过 `session.ts` 注册的 `onSingboxApiRestart` 钩子重启会话，让各条流换到 API driver；重启时的探测直接复用这次重试的结果；这份结果只在这次重启期间有效，重启结束（包括 Clash `/version` 失败、没走到 API 探测）后就清掉，之后的探测总会重新请求。
7. 会话用模块级递增的 token 判断过期：`probeActiveBackend` 返回时 token 已变就不再建流，同一后端被重新赋值（例如编辑后端）也能正确丢弃旧会话。

状态放在 `src/assembly/singbox/api/state.ts`。version.ts 只增加一行挂接调用。

### driver 选择

`assembly/driver/index.ts` 的 `driver()` 在现有的 `core === Core.Singbox` 分支里再判断一次：`singboxApi.value` 有值时返回 `singboxApiDriver`，否则返回 `singboxDriver`。`driverFor()` 和 `probeBackend` 不变。

### 能力表

`singboxCaps(variant, forkOverride, api?: { apiVersion: number })`：`api` 为空时结果与现在完全一致。

新增的 `Cap`：

| Cap | 为真的条件 |
|---|---|
| `singboxApi` | `api` 存在。概览状态卡、连接表新列都以它为准 |
| `tools` | `api` 存在 |
| `tailscale`、`openvpn`、`openconnect` | `api` 存在 且 `apiVersion ≥ 3` |
| `ebpfDiagnostics` | `api` 存在 且 `apiVersion ≥ 5` |
| `backendEvents` | `api` 存在 |

SniffHost 的规则：`Connection.domain` 取的是 `Fqdn`、`SniffHost`、`Domain` 中第一个非空值，无法从中拆出 sniffHost，所以 moonfruit 分支（sing-box `5507ef04a`）在 `Connection` 上加了 `sniffHost = 1000` 字段，直接读它。没有这个字段的旧 moonfruit 服务端读到空串，显示 `-`。只有 moonfruit 会探测 API，所以 SniffHost 列不需要按 API 门控。

`backend.ts` 的 `soft` 计算把 `singboxApi.value` 传给 `singboxCaps`。

## 传输层（`src/assembly/singbox/api/`）

| 文件 | 职责 |
|---|---|
| `gen/started_service_pb.ts` | protoc-gen-es 的生成产物，提交进仓库，加入 eslint 和 prettier 的 ignore |
| `client.ts` | 按 `uuid\|baseUrl\|password` 缓存单例。一元调用用 connect-web 的 `createGrpcWebTransport`（binary、fetch，拦截器加 Bearer 和 `Accept-Language`）；server streaming 用 `websocket.ts` 的 transport |
| `websocket.ts` | grpc-websockets 子协议下的 server streaming（见下） |
| `stream.ts` | 常驻流的通用封装（见下） |
| `state.ts` | `singboxApi`、`singboxApiError`、`singboxRuntime` 等 ref |
| `probe.ts` | `probeSingboxApi` |

### grpc-websockets

原因：局域网部署通常是明文 http，浏览器不会使用 h2c，同一主机最多只有 6 条 HTTP/1.1 连接。本设计的常驻流有 Status、Connections、Log、Groups、ClashMode 共 5 条，再加上工具页的流和 axios 请求，走 fetch 会超出上限。WebSocket 不占这个配额。上游 `e9880fab` 用同样的方式解决了这个问题。

协议（服务端实现见 `service/api/web_bridge_websocket.go`）：

- 连接 `ws(s)://host:port/daemon.StartedService/<Method>`，子协议为 `grpc-websockets`。
- 客户端第一条消息是二进制帧，内容为 HTTP 头文本：`content-type: application/grpc-web+proto`、`x-grpc-web: 1`、`authorization: Bearer <secret>`、`accept-language`，每行以 `\r\n` 结尾。
- 连接超时 5s：到时还没 open 就关闭 socket 并抛出 `ConnectError(Code.DeadlineExceeded)`。abort 之后立即结束，不再产出已缓冲的消息。
- 第二条消息是 `0x00` 加上 5 字节 gRPC 帧头（flag 和大端长度）再加请求消息；随后发送单字节 `0x01` 表示半关闭。
- 服务端回写的都是 gRPC-Web 帧：flag 为 `0x80` 的是头帧或 trailer（从中解析 `grpc-status`、`grpc-message`），其余是数据帧。一个 WS 消息里可能包含多个帧，一个帧也可能跨越多个 WS 消息，解析器必须按字节流处理。
- 接口形式为 `serverStream(method, request, signal): AsyncIterable<Response>`。trailer 的状态非 0 时抛出 `ConnectError(code)`。连接异常关闭时，抛出 `ConnectError(Code.Unavailable)`。

帧的编解码是纯函数，便于单元测试。只实现 server streaming，不实现 client streaming 和双向流。

### 常驻流封装 `stream.ts`

`createSharedStream<T>(open: (signal) => AsyncIterable<T>, options)`：

- 懒启动，按引用计数共享：第一个 `acquire` 时建立连接，最后一个 `release` 时 abort。
- 重连：退避为 `min(1000 × attempt, 5000)` ms，收到消息后 attempt 清零。
- 每次连接有自己的 AbortController（流的 controller 的子级）。监听者的第二个参数是 `{ firstOfConnection }`，每次连接的第一条消息为 true。
- 可选 `idleTimeoutMs`：连接后这段时间内没收到消息，就 abort 当前连接并按正常的退避重连（error 记为 DeadlineExceeded，不是终止错误）。只有 `SubscribeStatus` 设为 5s（服务端每秒推送）；`SubscribeConnections` 只在有事件或流量变化时推送，没有流量时长时间静默是正常的，所以不设；日志、分组、模式和工具页的流同样不设。
- 终止码 `Unauthenticated`、`PermissionDenied`、`Unimplemented` 不重连，phase 置为 `error`。
- 对外暴露 `phase: 'connecting' | 'active' | 'error'`、`error`，以及一个 `onReconnect` 回调，供需要处理 reset 的消费方使用。
- `retryNow()`：在 `visibilitychange`（页面变为可见）和 `online` 时，由 `streams.ts` 统一对所有活跃流调用：处于退避等待时跳过等待；设了 idle 超时的流（目前只有 Status）已连接但最后一条消息早于 idle 超时时，abort 当前连接立即重连（计时器被后台节流时靠这一步发现死连接）。没有 idle 超时的流只跳过退避等待。
- moonfruit 执行 `PUT /configs` 重载会重建 API service，所有流都会断开，由这套机制自动恢复。

## 各域映射（`src/assembly/driver/singbox-api.ts`）

`singboxApiDriver = { ...singboxDriver, metrics, connections, logs, events }`，其余子接口沿用 Clash 形态。各域的映射逻辑放在 `src/assembly/singbox/` 下的纯 TS 模块里，driver 只负责组装。

### metrics（`singbox/status.ts`）

- 共享一条 `SubscribeStatus({ interval: 1_000_000_000n })` 流，interval 单位是纳秒。
- `traffic()` 映射为 `{ down: downlink, up: uplink, downTotal: downlinkTotal, upTotal: uplinkTotal }`，bigint 转 number。
- `memory()` 映射为 `{ inuse: memory }`。
- 每个样本同时写入 `singboxRuntime`：`{ goroutines, connectionsIn, connectionsOut }`。
- `fetchRuntimeStats` 沿用 Clash 形态（sing-box 下不开 `runtimeStats`）；`history` 不实现。
- 会话开始时调用一次 `GetStartedAt`，写入 `singboxRuntime.startedAt`（毫秒）。

### connections（`singbox/connections.ts`）

- 订阅 `SubscribeConnections({ interval: 1s })`，由累加器 `createConnectionAccumulator()` 处理：
  - 首帧 `reset=true`：清空后重建。事件都是 NEW，`closedAt > 0` 的放进已关闭列表。
  - 之后收到 `reset=true`（重连）：清空后重建，已关闭列表按 id 去重。
  - NEW：放入活跃集合。
  - UPDATE：把 `uplinkDelta`、`downlinkDelta` 累加到该连接的 `uplinkTotal`、`downlinkTotal`。
  - CLOSED：从活跃集合移除，带上 `closedAt`，放进本批的 closed。
- 每处理完一帧 `ConnectionEvents`，产出 `ConnectionsPayload = { connections: 活跃列表（新对象）, closed: 本批关闭的连接 }`。`downloadTotal`、`uploadTotal` 不填，由 metrics 流提供。
- 门面 `initConnections` 只加一行挂接（见下一条的 `reset`）：速率由前后两次累计值相减得出，已关闭连接按现有规则合并，上限 500 条。
- 重连（非首帧的 `reset=true`）后的第一个 payload 带 `reset: true`（`ConnectionsPayload` 的可选字段，上游挂接点），`initConnections` 这一帧把速率记为 0，不把断线期间的流量算成一秒的速率。
- `disconnect(id)` 调 `CloseConnection`；`disconnectAll(filter)` 在没有 filter 时调 `CloseAllConnections`，有 filter 时交给 Clash 路径的 `singboxDriver`（sing-box 不开 `connectionsFilterClose`，视图层不会传 filter）。`block` 沿用 Clash 形态（sing-box 不开相应能力）。
- 新类型 `SingboxConnectionRawMessage`（放在 fork 新增的 `src/types/singbox.d.ts`），字段对应 proto 的 `Connection`，int64 字段转为 number。`src/types/index.d.ts` 的 `ConnectionRawMessage` 联合类型加入它，这是一处上游挂接点。
- accessor 映射：

| accessor | 取值 |
|---|---|
| `rule` | `rule` |
| `rulePayload` | `''` |
| `sourceIP` / `sourcePort` | 拆分 `source` 的 `ip:port`（兼容 IPv6 的 `[..]:port`） |
| `network` | `network` |
| `networkType` | `` `${inboundType}/${network}` `` 的大写形式，与 Clash 的 `type/network` 展示方式一致 |
| `hostname` / `host` | `domain` 非空时为 `domain:port`，否则为 `destination` |
| `process` | `processInfo.processPath` 的文件名部分；为空时取 `packageNames[0]` |
| `destination` | `destination` 的 ip 部分 |
| `inboundUser` | `user` |
| `sniffHost` | `sniffHost` |
| `remoteAddress` | `''` |
| `chains` | `chainList`，顺序对齐 Clash accessor 约定 |
| `download` / `upload` | `downlinkTotal` / `uplinkTotal` |
| `start` | `createdAt`（毫秒） |
| `isDirect` | `outboundType === 'direct'` |
| `smartBlock` | `undefined` |

- 连接表新增列，挂在上游的 `CONNECTIONS_TABLE_ACCESSOR_KEY` 和 `getConnectionDisplayValue` 上：`Protocol`（嗅探到的协议）、`Inbound`（`inbound`，也就是 inbound tag）、`FromOutbound`、`OutboundType`。
  - accessor 增加对应的可选方法；Clash 和 dae 不实现，显示 `-`。
  - 这 4 列只在 `can('singboxApi')` 时出现在列设置、卡片设置、搜索和分组的键列表里，默认不显示。
- DNS 出站的连接保留，可以用 `OutboundType` 列识别。

### logs（`singbox/api-logs.ts`、`singbox/ansi.ts`）

- 订阅 `SubscribeLog`（不带参数）。
- 每条 `LogMessage` 的处理：
  1. `ansi.ts` 的 `parseAnsi(message)` 把文本解析成 `AnsiSegment[]`，每段为 `{ text, fg?, bg?, bold?, dim?, italic?, underline? }`。颜色支持 16 色（包括亮色）、256 色和 24 位真彩色；未知的 SGR 序列忽略，`0` 表示 reset。
  2. 去掉开头的级别和时间前缀：去色后的纯文本匹配 `^[A-Z]+(\[\d+\]|\s\S+)?\s`，对应默认格式 `INFO[0012] ` 和 FullTimestamp 格式；segments 同步裁掉。
  3. `payload` 为去色、去前缀后的纯文本，现有的 `getSingboxLogType`、`getLogConnectionID` 和搜索都照常工作。
  4. `type` 由 PbLogLevel 一一映射到 `LOG_LEVEL`：PANIC 为 `panic`，FATAL 为 `fatal`，ERROR 为 `error`，WARN 为 `warning`，INFO 为 `info`，DEBUG 为 `debug`，TRACE 为 `trace`。sing-box 下已经开启了 `extraLogLevels` 和 `traceLogLevel`。
- `Log` 类型增加可选字段 `ansi?: AnsiSegment[]`（上游类型挂接点）。
- 级别过滤在 driver 里做：`subscribe(level, onBatch)` 只投递不低于 `level` 的条目，`silent` 时什么都不投递。先按 PbLogLevel 过滤，再做 ANSI 解析，被过滤的行不解析。
- 积压（首次订阅或某次连接的首帧 `reset=true`）的时间：`toLog(message, startedAt)` 从去色后的 `LEVEL[NNNN]` 前缀取出相对秒数，`timestamp = startedAt + NNNN × 1000`（`Log` 的可选字段，上游类型挂接点）；`initLogs` 用 `dayjs(data.timestamp)` 显示，没有值时即接收时间。实时行和 `startedAt` 未知（0）时不设。
- 重连时的积压去重（`dedupeBacklog(delivered, backlog)`，纯函数）：
  - driver 记住最近投递的 64 条原始 message；
  - 重连后某次连接的首帧 `reset=true`（`firstOfConnection`）时，在积压里找出与这 64 条尾部重叠的最长后缀，只投递重叠之后的部分；
  - 找不到重叠（例如日志已经被清空）时全部投递。
  - 首次订阅时的积压全部投递。
  - 连接中途（非 `firstOfConnection`）的 `reset=true` 说明日志被服务端清空（例如其他客户端调用了 ClearLogs），服务端可能把清空之后的新行合并在同一条消息里：driver 清空已投递窗口，调用 `subscribe` 的可选第三个参数 `onReset`（`initLogs` 借此清空待刷新和已显示的日志），再把这条消息里的行当作新行投递。
- 源 IP 标签：`initLogs` 用 `replaceAnsiText(segments, matchers)` 在拼接后的纯文本上替换，再按原 segments 重建；替换文本继承匹配起点所在段的样式，未触及的文本保留原样式，所以跨段的匹配也不会让该行退回无色显示。`parseAnsi` 会丢掉行尾被截断的转义序列（`ESC[` 加数字和分号，或单独的 `ESC`）。
- 渲染：新增 `src/components/singbox/AnsiText.vue`，接收 `segments` 和 `filter`，按段输出带颜色的 span，并对 filter 关键字做高亮，效果与 `HighlightText` 一致。
  - `LogsCard.vue`、`LogsTable.vue` 各加一处挂接：`log.ansi` 存在时用 `AnsiText`，否则仍用 `HighlightText`。
  - 颜色映射到 daisyUI 的主题变量（例如 16 色里的红色对应 `--color-error` 一类），在亮色和暗色主题下都要保证可读。256 色和真彩色直接使用 RGB。

### events（`singbox/events.ts`）

- `events.subscribe(onEvent)` 订阅 `SubscribeGroups` 和 `SubscribeClashMode` 两条共享流，每条流的首帧跳过：
  - Groups 推送时发出 `proxies.changed`；
  - ClashMode 推送时，如果 mode 与上一条不同，发出 `configs.changed`。
- `singboxCaps` 在 `api` 存在时打开 `backendEvents`。
- `session.ts` 的 `initEvents` 增加两个 kind 的处理（上游挂接点）：
  - `proxies.changed`：防抖 400ms 后只调用 `fetchProxies`；
  - `configs.changed`：防抖 400ms 后只调用 `fetchConfigs`。
  - 已有的 `generation.changed` 行为不变。
- 模式切换仍然用 `singbox/mode.ts` 的 `changeMode`，也就是先 PATCH 再断开相关连接。

### 会话

- `startBackendSession` 的流程不变，`probeActiveBackend` 已经包含了 API 探测。
- `singboxApiDriver.reset` 不依赖被调用（session 在 probe 之前调用的是上一个后端的 driver）。流的清理由各个 `close()` 和 release 负责；`singboxRuntime` 在 `resetCore` 时清空。

## 概览增强

- 新增 `src/components/singbox/SingboxStatsCard.vue`，显示运行时长（由 `startedAt` 每秒更新）、goroutines、进/出连接数。
- 按 `HonkStatsCard` 的方式注册成概览卡片（`constant` 中的卡片枚举、`store/settings.ts` 的卡片列表、`OverviewPage.vue` 的组件映射、`OverviewCardSettingsDialog.vue`），只在 `can('singboxApi')` 时显示。
- 连接页的增强见上文“connections”。首帧自带的最近已关闭连接会直接进入已关闭列表。

## 工具页

> 2026-09-25 修订：第一版把全部工具堆在一个长页面里，表单常驻，用大号数字格子装文本，并且卡片套卡片，与 zashboard 的风格不一致。本节按上游旧版（`4adb4872^` 的 `ToolsPage` 及 `src/components/tools/*`）的结构重做，同时借鉴 sing-box-dashboard 的几点设计（只借鉴思路，不复制代码）。修订前对比了第一版、上游 `4adb4872^` 旧版和 sing-box-dashboard 的截图。

### 路由与挂接

- `ROUTE_NAME.tools`，图标 `WrenchScrewdriverIcon`，路由 `() => import('@/views/ToolsPage.vue')`。
- `renderRoutes` 按 `can('tools')` 过滤。router 的 `beforeEach` 在目标是 tools 且 `!can('tools')` 时，先 `await coreReady()` 再判断，不满足则重定向到 proxies；当前停在 tools 页时，一旦 `can('tools')` 变为 false，也同样先等 `coreReady()` 再跳到 proxies。
- 需要改的上游文件：`constant/index.ts`（`ROUTE_NAME`、`ROUTE_ICON_MAP`）、`router/index.ts`、`helper/index.ts`（`renderRoutes`），以及 fork 文案。

### 页面结构

- 顶部用 `CtrlsBar` + `SegmentedControl` 分 tab，从左到右：
  - **网络**：`can('tools')` 时始终显示；
  - **Tailscale**、**OpenVPN**、**OpenConnect**：对应的能力为真，并且状态流里至少有一个端点时显示；
  - **eBPF**：`can('ebpfDiagnostics')` 为真，并且诊断结果里有 inbound 时显示。
- 页面层用 `useToolsAvailability()` 统一订阅 Tailscale、OpenVPN、OpenConnect 三条共享流，并在进入页面时拉取一次 eBPF 诊断，得出可见 tab，同时把数据交给各 tab。tab 显示逻辑由纯函数 `visibleTabs(input)` 计算。
- 当前 tab 用 `useStorage` 记住；记住的 tab 不再可见时，回到“网络”。
- 内容统一用设置页的行列表样式（`settings-grid`）：标签在左，值在右，可点击的行末尾带箭头，数值用等宽字体、右对齐。不再使用大号数字格子，也不再卡片套卡片。
- 组件放在 `src/components/singbox/tools/`，以上游旧版组件为蓝本移植（MIT、同一技术栈），数据改为来自 `src/assembly/singbox/tools/*`。OpenConnect 和 eBPF 上游没有实现，按同样的样式新写。Taildrop、SSH、USB/IP 仍不做。

### 网络 tab

- 桌面上网络质量和 STUN 左右两列，手机上上下排列。
- **网络质量**
  - 配置行：配置 URL；出站节点（可搜索的选择对话框，显示节点类型和最近延迟）；最长运行时间（默认 / 10s / 20s / 30s / 60s）；串行、HTTP/3 两个开关；开始 / 取消按钮。
  - 运行中禁用输入，按钮显示转圈。
  - 结果卡片在开始测试后才出现：
    - 顶部显示当前阶段和已用时间；
    - 中间是上下行吞吐曲线，由 `appendThroughput` 从进度消息里累积，最多 120 个点；
    - 下方逐行显示下行/上行速率、下行/上行 RPM、空闲延迟。数值和单位分开排版，每行末尾带精度色标（高为绿、中为黄、低为灰）。
- **STUN**
  - 配置行：服务器、出站节点、开始按钮。
  - 结果逐行显示外部地址（可复制）、延迟、NAT 映射、NAT 过滤。NAT 类型按 `natTone` 着色：与端点无关为绿，与地址相关为黄，与地址和端口相关为红。
  - `natTypeSupported === false` 时显示一行提示。

### Tailscale tab

- 每个端点一段。
- **段头**：tag，加上按状态着色的标签（Running 绿，NeedsLogin 黄，其他灰）；登出按钮只在 `keyAuth` 为假时显示，点击后需要在确认对话框里确认。
- **需要登录时**：显示“需要登录”一行，点击后在对话框里显示二维码（`QRCodeView`，`uqr`）和链接。链接只允许 http/https。
- **状态行**：
  - 本设备：主机名，点开可查看并复制 IP；
  - 出口节点：只在有候选节点时显示，点开是可搜索的选择对话框，含“不使用”；设置失败时保持对话框打开，并回到服务端的实际值；
  - 网络：tailnet 名称；
  - MagicDNS：域名后缀。
- **peer 列表**：按用户分组，一行一个，显示在线圆点、主机名、第一个 IP。行尾标签只在需要时出现：出口节点、已过期（红）、30 天内过期（黄）。过期状态由 `expiryState` 判断。
- **peer 详情对话框**：
  - 地址（可复制）、系统、最后在线时间（相对时间）、密钥过期时间、收发流量；
  - Ping：开始/停止、最近延迟、连接方式（由 `pingPath` 判断：直连 endpoint / peer relay / DERP 区域）、`PingSparkline` 曲线。关闭对话框时停止 ping。

### OpenVPN / OpenConnect tab

- 每个端点一段。段头是 tag 加按状态着色的标签。
- 行列表显示：服务器、地址、DNS、MTU、连接时长（相对时间，`connectedSince` 是 Unix 秒）、加密算法（OpenVPN）或传输方式（OpenConnect）。没有值的行不显示。
- 有待应答的认证请求时，在段顶部显示请求卡片：
  - OpenVPN：
    - `credentials`：显示用户名、密码和验证码；
    - `secret`：显示验证码，`echo` 决定是否以明文显示；
    - `message`：显示通知文本；
    - `open-url`：显示认证链接（只允许 http/https）；
    - 带截止时间时显示倒计时（`deadlineIn`）。
  - OpenConnect：表单字段为 text、password、select，`hidden` 字段只随表单提交；浏览器 SSO 只显示链接和“需在 sing-box 客户端完成”的提示，并提供取消。
  - 表单状态按端点 tag 分开保存。
- 通过 `Submit*` 提交，也可以通过 `Cancel*` 取消。

### eBPF tab

- 每个 inbound 一段，行列表显示：状态（着色）、数据面、UDP 会话数、最近错误（红色）。其余字段（恢复状态、计数器、UDP NAT 等）放在段末折叠的“原始数据”（JSON）里。
- 内核运行时单独一段，内容是折叠的“原始数据”（JSON）。
- 右上角有刷新按钮；请求失败时显示错误，而不是空状态。

### 流的生命周期

- 状态类订阅由 `useToolsAvailability` 在页面挂载时 acquire、卸载时 release；三条流都是共享流，走 WS 传输和 `stream.ts` 的重连机制。
- 测试类流（网络质量、STUN、ping）是一次性的：每次操作新建一个 AbortController，出错不重连，结果和错误显示在所属卡片或对话框内。切换后端时取消正在进行的测试。

## 错误处理

- **探测失败**：静默使用 Clash。后端设置页（`BackendSettings.vue`，挂接一个 `SingboxApiStatus.vue` 组件）只在 moonfruit 变体下显示“sing-box API：已连接（apiVersion N）”或具体的失败原因。`unauthorized` 时提示 API service 的 secret 需要与 Clash secret 一致；`unimplemented` 和 `network` 时提示需要把 API service 配置在与 `external_controller` 相同的地址端口上。
- **常驻流终止错误**：phase 置为 `error`，不重连，自动退回 Clash：`singboxApiError` 记为 `toApiError` 映射的原因，清空 `singboxApi`（`driver()` 回到 Clash 路径的 `singboxDriver`，`can('singboxApi')` 变为 false），并通过 `onSingboxApiRestart` 钩子重启会话；状态组件显示失败原因。
  - Unauthenticated / PermissionDenied（`unauthorized`）：和切换后端一样从探测开始重启，不设禁止探测的标记。重新探测时 `GetVersion` 同样鉴权失败，于是留在 Clash，状态行显示未授权；之后改对 secret，下一次会话启动就会恢复 API。`GetVersion` 与流共用鉴权，所以不会循环。
  - 其他终止错误（Unimplemented 等）：记下该后端，在 `activeBackend` 变化（切换后端、编辑同一后端）或刷新页面之前不再探测 API，避免 `GetVersion` 成功而流报 Unimplemented 时反复重启。
  - Clash 的 HTTP 401 保持上游行为（打开后端编辑并提示），不自动重启。
  - 会话重启会同步停止所有常驻流，其他流随后到来的终止错误在 `stream.ts` 里因父级已 abort 而直接返回，不会重复触发。
- **子路径**：后端带 `secondaryPath` 时不探测，状态组件提示“已跳过 API 探测：后端使用了子路径”。
- **一元调用错误**：沿用现有的 toast 提示，内容取 `ConnectError.rawMessage`。
- **一元调用的并发**：一元调用走 fetch，会与 axios 共用 HTTP/1.1 连接池，但都是短请求，不会长期占用连接。

## 依赖与代码生成

- 根目录 `package.json` 增加 dependencies：`@connectrpc/connect`、`@connectrpc/connect-web`、`@bufbuild/protobuf`、`uqr`（这是改动上游文件，无法避免；lockfile 冲突时按 FORK.md 的规则处理）。
- 新增独立的 pnpm 项目 `fork-proto/`：
  - `package.json` 的 devDependencies 为 `@bufbuild/buf`、`@bufbuild/protoc-gen-es`，版本与根目录的 `@bufbuild/protobuf` 大版本一致；
  - `proto/daemon/started_service.proto` 从 sing-box `moonfruit` 分支 vendor 过来，文件头部记录来源 commit；
  - `buf.gen.yaml` 使用 `target=ts`，输出到 `../src/assembly/singbox/api/gen`；
  - 脚本 `pnpm -C fork-proto generate`，另有 `sync` 从本地 sing-box 源码拷贝 proto。
- 生成产物提交进仓库，构建和 CI 不依赖 buf。
- `eslint.config.js` 和 `.prettierignore` 加入生成目录，是两处很小的上游挂接点。
- `fork-ci.yml` 增加一步：重新生成代码后执行 `git diff --exit-code`，防止生成产物与 proto 不一致。

## i18n

新增文案（工具页各区块、概览卡片、连接表新列、API 状态提示、路由名）放在 fork 自有的 `src/i18n/singbox/{en,zh,zh-tw,ru}.ts`，四份同时添加；上游的四个语言文件各只加一行 `...singboxXx` 展开作为挂接点。

## 测试

fork-test（vitest + happy-dom），放在 `fork-test/singbox/`：

- `websocket.test.ts`：请求头帧和数据帧的编码；响应帧的解码，包括跨消息拆分、一条消息多帧、trailer 状态码映射为 `ConnectError`。
- `stream.test.ts`：引用计数启停、退避节奏（使用 fake timers）、终止码不重连、`retryNow`、`firstOfConnection`、idle 超时和陈旧连接的强制重连。
- `probe.test.ts`：子路径跳过、探测代号、一次重试与会话重启、退回 Clash；`session.test.ts`：会话 token；`fallback.test.ts`：常驻流终止错误触发退回。
- `connections.test.ts`：累加器处理 reset、NEW、UPDATE、CLOSED、重连 reset 的去重，以及产出的 payload 形状；accessor 映射，包括 IPv6 的 source 拆分。
- `ansi.test.ts`：16 色、亮色、256 色、真彩色、粗体和 reset、未知序列，以及去前缀后 segments 的对齐。
- `api-logs.test.ts`：级别映射、级别过滤、`dedupeBacklog` 的各种情况。
- `status.test.ts`：Status 映射为 traffic、memory 和 runtime。
- `events.test.ts`：跳过首帧，ClashMode 值不变时不发事件。
- `capabilities.test.ts`：`singboxCaps` 带不带 `api`、apiVersion 3/4/5 时的矩阵，以及 `singboxApi`、`backendEvents`。
- `driver.test.ts`：`driver()` 在 moonfruit 且 API 可用时选中 `singboxApiDriver`，其余情况不变。

冒烟：新增 `fork-test/mock-singbox-api.mjs`，在同一端口上提供 gRPC-Web 一元调用（GetVersion、GetStartedAt、Close*、Tailscale 相关操作）和 grpc-websockets 流（Status、Connections、Log、Groups、ClashMode、一个 Tailscale endpoint），其余请求反向代理到 `test/mock-server.mjs`。配合 `pnpm dev` 做手动验证。最后在真实的 moonfruit sing-box 上做一次端到端验证。

## 交付拆分

每一步都能独立通过 `pnpm type-check`、`pnpm exec eslint .`、`pnpm -C fork-test test` 和 `pnpm build`。

1. **基础**：`fork-proto/` 与生成代码、依赖、`websocket.ts`、`stream.ts`、`client.ts`、探测、状态、`singboxCaps` 扩展、driver 选择（此时 `singboxApiDriver` 只是 `{...singboxDriver}`）、`SingboxApiStatus`。
2. **数据通道**：metrics、connections（累加器、accessor、类型挂接）、logs（ANSI 解析与渲染、去重）、events 与 session 挂接。
3. **现有页面的增强**：`SingboxStatsCard`、连接表新列。
4. **工具页（一）**：路由挂接、页面骨架、网络质量、STUN、eBPF。
5. **工具页（二）**：Tailscale、OpenVPN、OpenConnect。
