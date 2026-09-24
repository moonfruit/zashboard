# 恢复 sing-box 支持（Clash API）设计

- 日期：2026-09-24
- 分支：`feat/singbox`（自 `moonfruit` 拉出）
- 性质：moonfruit fork 长期维护的自有特性

## 背景与目标

上游 Zephyruso/zashboard 在 v3.23.0（`4adb4872`）一次性移除了 sing-box 支持，其后又在 2026-09-18 完成 assembly 层重构（引入 `Driver` 抽象）并删除全部注释。因此本特性不能 revert，而要在现架构上重写。

本阶段目标：

1. 恢复 sing-box 内核在 **Clash API** 上的特殊处理（上游删除前的「clash 通道 + sing-box 内核」形态）。
2. 区分三种 sing-box 变体并自动识别：官方 sing-box、ref1nd、moonfruit（基于 ref1nd 的自维护版本）。
3. 为将来接入 sing-box 原生 gRPC API 预留结构上的接入口。moonfruit 版 sing-box 已实现 Clash API 与 gRPC API 监听同一端口，将来 gRPC 应复用同一套后端配置，作为 Clash 后端的增强，而不是独立后端。

非目标：

- 不接入 gRPC API，不恢复 Tools 页（Tailscale / Terminal / USBIP / OpenVPN / Taildrop 等）。
- 不恢复 sing-box 弃用公告。
- 不新增 `BackendType`，不改动 `store/setup.ts` 的旧数据迁移。
- 不恢复上游 `728588e2`（sing-box 内核下 provider 节点测速改走全局 `/proxies`）：当前 ref1nd 已提供 provider 作用域 healthcheck，官方版 provider 为空，该分支无意义。

## 设计约束

- **最小化与上游的冲突面**：fork 自有逻辑放新文件；对上游文件只加小挂接点；复用 `clashDriver`，不复制重写。
- 代码风格跟随上游当前风格（无注释、`can()` 门控、assembly 层隔离）。

## 识别

### core 轴

`src/assembly/version.ts` 的 `detectCore` 在版本串包含 `sing-box` 时返回新增的 `Core.Singbox`。三种变体 `/version` 均返回 `"sing-box " + C.Version`，已从源码确认。

### 变体

| 变体 | 版本串示例 | 判定 |
|---|---|---|
| `Moonfruit` | `sing-box 1.15.0-alpha.6-reF1nd-moonfruit`、`…-reF1nd.2-moonfruit.2` | 含 `-moonfruit` |
| `Refind` | `sing-box 1.15.0-alpha.6-reF1nd`、`…-reF1nd.2` | 含 `-reF1nd` |
| `Official` | `sing-box 1.14.1` | 其余 |

判定顺序为 moonfruit → ref1nd → official。仅当 `core === Core.Singbox` 时有意义。

识别失败时的退路：沿用现有行为，即版本串不含 `sing-box` 时按 mihomo 默认分支处理，本阶段不增加手动指定内核的入口。

## 能力矩阵

依据：本地 sing-box 仓库 `experimental/clashapi` 的路由与实现，对比官方 `origin/testing`、ref1nd `v1.15.0-alpha.6-reF1nd`、`moonfruit` 分支。

| Cap | Official | Refind | Moonfruit | 依据 |
|---|:-:|:-:|:-:|---|
| `dashboardUpgrade` | ✓ | ✓ | ✓ | `POST /upgrade/ui` |
| `coreRestart` | ✗ | ✓ | ✓ | ref1nd 新增 `POST /restart` |
| `reloadConfigs` | ✗ | ✓ | ✓ | ref1nd `PUT /configs` 为 reload；官方为空实现 |
| `proxyProviderUpdate` | ✗ | ✓ | ✓ | 官方 providers 为桩 |
| `proxyProviderHealthCheck` | ✗ | ✓ | ✓ | 同上 |
| `ruleProviders` | ✗ | ✓ | ✓ | 同上 |
| `independentLatency` | ✓ | ✓ | ✓ | `/proxies/{name}/delay` |
| `traceLogLevel` | ✓ | ✓ | ✓ | sing-box 日志级别 |
| `silentLogLevel` | ✗ | ✗ | ✗ | `log.ParseLevel` 不认 `silent`，`/logs?level=silent` 返回 400 导致 WS 无限重连（最终审查发现，已对照三种源码与实机确认） |
| `extraLogLevels`（新增，fatal / panic） | ✓ | ✓ | ✓ | 同上 |
| `customGlobalNode`（新增） | ✓ | ✓ | ✓ | 恢复 |
| `logTypeFilter`（新增） | ✓ | ✓ | ✓ | 日志 payload 带 `type:` 前缀 |
| `logConnectionDetail`（新增） | ✓ | ✓ | ✓ | 日志以 `[id 耗时] tag: ` 开头；id 为日志上下文 id（非 `/connections` 的 UUID），用于筛出「同连接日志」 |
| `disconnectOnModeChange`（新增） | ✓ | ✓ | ✓ | 切模式后需断开命中 `clash_mode` 的连接 |
| `latencyTest` `nodeLatencyTest` `customTestUrl` `dnsQuery` `flushDNSCache` `flushFakeIP` `connectionsClose` | ✓ | ✓ | ✓ | 三者均有 |
| `coreUpgrade` `coreUpdateCheck` `updateConfigs` `updateGeoDatabase` `syncSettings` `configPatch` `runtimeStats` | ✗ | ✗ | ✗ | 无端点，或 PATCH `/configs` 只认 `mode`，或 reload 忽略 path/payload |

说明：

- moonfruit 仅在存在 `configChecker` 时注册 `PUT /configs`，否则 405。前端无法预知，仍点亮 `reloadConfigs`，失败走现有错误提示。
- rules 启用切换已由上游按 `rule.uuid` 数据自证（ref1nd 走 `PUT /rules/{uuid}`），不进能力表。
- 当前 moonfruit 与 ref1nd 在 Clash API 上能力一致；区分 moonfruit 变体主要是为 gRPC 预留。

### displayAllFeatures

`displayAllFeatures` 在上游仍存在，但只作用于 honk。本特性把 `Core.Singbox` 纳入 `isNonMihomoCore`：

- sing-box 内核下显示该开关。
- 开启后按与 honk 相同的语义放开 `mihomoOrForkCore` 一组：`coreUpgrade` `coreRestart` `dashboardUpgrade` `reloadConfigs` `updateConfigs` `updateGeoDatabase` `syncSettings` `independentLatency`。
- 其余能力（`coreUpdateCheck` `configPatch` 等）不受影响。

## 架构

### driver 选择

`src/assembly/driver/index.ts` 的 `driverFor`：`backend.type === 'clash'` 且 `core === Core.Singbox` 时返回 `singboxDriver`，其余不变。

时序：`startBackendSession` 先 `await probeActiveBackend()` 再建流。探测期间 `core` 为 `Unknown`，用的是 `clashDriver.system`（`probe` / `fetchVersion` 与 sing-box 通用）；建流时 `core` 已确定，不存在需要重建流的问题。`probe.ts` 的 `driverFor(backend)` 用于未激活后端的连通性探测，同样走 clash，符合预期。

### 新增文件（fork 自有）

- `src/assembly/singbox/variant.ts`：`SingboxVariant` 枚举、`detectSingboxVariant(version)` 纯函数、`singboxVariant` computed（`core !== Singbox` 时为 `undefined`）。
- `src/assembly/singbox/capabilities.ts`：纯函数 `singboxCaps(variant, forkOverride): Caps`，即上面的能力矩阵。
- `src/assembly/driver/singbox.ts`：`singboxDriver: Driver = { ...clashDriver }`，按需覆盖。本阶段预期无覆盖项，它是 sing-box 相关后端行为的唯一锚点。
- `src/assets/images/sing-box.svg`：从 `4adb4872^` 恢复。

### 上游文件挂接点

| 文件 | 改动 |
|---|---|
| `src/assembly/backend.ts` | `Core.Singbox`；`isNonMihomoCore` 纳入 sing-box；`soft` 在 sing-box 内核时取 `singboxCaps(singboxVariant, isForkCoreOverride)`；`Cap` 联合类型追加 5 个新能力 |
| `src/assembly/version.ts` | `detectCore` 识别 sing-box；`coreBrand` 加 sing-box logo 与 `https://github.com/SagerNet/sing-box` |
| `src/assembly/driver/index.ts` | `driverFor` 按 core 选择 `singboxDriver` |
| `src/assembly/logs.ts` | `extraLogLevels` 追加 fatal / panic |
| `src/store/logs.ts` | 恢复 `getLogConnectionID`（不恢复已被上游删除的 `helper/ansi`：Clash API 日志经 `FormatSimple` 输出，不含 ANSI 颜色） |
| `src/components/controls/LogsCtrl.tsx` | `logTypeFilter` 下按 `[..] type:` 提取类型 |
| `src/components/logs/LogsCard.vue`、`LogsTable.vue`、`src/views/LogsPage.vue` | 恢复「同连接日志」点击与弹窗 |
| `src/components/controls/ProxiesCtrl.tsx` | `disconnectOnModeChange` 且开启自动断开时，切模式断开 `rule` 含 `clash_mode` 的连接 |
| `src/components/settings/proxies/ProxiesSettings.vue`、`src/config/settings-items.ts`、`src/store/settings.ts`、`src/composables/proxies.ts` | 恢复自定义全局节点 |
| `src/i18n/{zh,zh-tw,en,ru}.ts` | 补回 `customGlobalNode`、`sameConnectionLogs` 等被删文案 |

UI 挂接点照抄删除前的逻辑，按当前代码结构改写，统一以 `can('xxx')` 门控。

## gRPC 预留

本阶段只定结构位置，不添加空接口、空字段：

- **接入点**：`singboxDriver`。将来仅在 `Moonfruit` 变体下，于同一 `host:port` 探测 gRPC API；需要改走 gRPC 的方法在 `singboxDriver` 中覆盖。
- **配置**：复用同一 `Backend`（host / port / password），不新增 `BackendType`，不碰 `setup.ts` 迁移。
- **能力**：gRPC 探测所得能力（如 Tailscale 管理）并入 `singboxCaps` 的输入，模式同上游 dae 以 `/capabilities` 结果填能力表；UI 只认 `can()`。

## 验证

项目无单元测试框架；为避免改动上游 `package.json` / lockfile，不引入 vitest。

1. `pnpm type-check`、`pnpm lint`、`pnpm build` 通过。
2. `test/mock-server.mjs` 增加可配置 `/version` 的参数，用 mock 分别模拟 mihomo / 官方 sing-box / ref1nd / moonfruit，检查：
   - 核心品牌 logo；
   - 各 Cap 对应入口的显隐与矩阵一致；
   - `displayAllFeatures` 仅在 honk / sing-box 下出现且按预期放开。
3. 用本地真实 sing-box（官方、ref1nd、moonfruit 构建）实测：日志类型过滤、同连接日志、切模式断开、自定义全局节点、重启 / reload / provider 更新。
4. 回归：mihomo、dae 后端行为不变。
