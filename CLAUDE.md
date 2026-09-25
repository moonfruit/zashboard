# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库性质

这是 [Zephyruso/zashboard](https://github.com/Zephyruso/zashboard) 的 fork（`moonfruit/zashboard`），一个连接代理内核 API 的 Vue 3 + TypeScript + Vite 面板。分支、版本、发版、同步上游的约定以 `FORK.md` 为准，动手前先读它。要点：

- 发行分支是 `moonfruit`（不是 `main`）；`main` / `upstream` 只快进镜像上游，不提交。新特性从 `moonfruit` 拉 `feat/*`，PR 目标是 fork 的 `moonfruit`；用 `gh` 时显式加 `--repo moonfruit/zashboard`，否则可能开到上游。
- fork 自有特性要长期随上游同步：**新逻辑放新文件，上游文件只加最少的挂接点**；不格式化、不重构上游代码；不改 `CHANGELOG.md` 和 `package.json` 的 `version`；不要 `git push --tags`。
- 上游已删除全部注释，新代码也不写注释。
- 远程：`origin` = fork，`zephyruso` = 上游（push 已禁用）。

## 命令

包管理器是 `pnpm@11`（`packageManager` 锁定），不要用 npm / yarn。

```bash
pnpm i
pnpm dev                      # Vite 开发服务器
pnpm type-check               # vue-tsc --build --force
pnpm lint                     # eslint . --fix（会改文件）；只检查用 pnpm exec eslint .
pnpm build                    # FONT 环境变量或 build:*-only 脚本切换字体变体
```

pre-commit（husky）会跑 `pnpm type-check` 和 lint-staged（eslint --fix、prettier --write、sort-package-json），所以提交会自动改写暂存文件。

### sing-box API 代码生成（`fork-proto/`）

`pnpm -C fork-proto i && pnpm -C fork-proto sync && pnpm -C fork-proto generate`，产物在 `src/assembly/singbox/api/gen/`（提交，eslint / prettier 忽略）。主 chunk 只能 `import type` 生成代码，运行时值只在懒加载的 `runtime.ts` 链路里用。

### fork 测试（`fork-test/`）

独立的 pnpm 项目（自己的 lockfile，vitest + happy-dom），不碰上游依赖；`@` 指向 `../src`，被测源码的依赖从根 `node_modules` 解析，所以先装根依赖。

```bash
pnpm -C fork-test i
pnpm -C fork-test type-check                          # 用根目录的 vue-tsc，同时检查 src 与测试
pnpm -C fork-test test
pnpm -C fork-test exec vitest run singbox/mode.test.ts   # 单个文件
pnpm -C fork-test exec vitest run -t 'changeMode'        # 按用例名过滤
```

按特性分子目录（如 `fork-test/singbox/`）。组件（`.vue` / `.tsx`）没有测试环境，需要测的逻辑先抽到 `src/assembly/**` 的纯 TS 模块再测。

### 上游的冒烟脚本（`test/`）

`test/mock-server.mjs` 模拟 Clash API：`node test/mock-server.mjs --port 19999 --version 'sing-box 1.15.0-alpha.6-reF1nd'`（`--version` 决定被识别成哪种内核，sing-box 版本串下 `/logs` 会推 sing-box 格式日志）。面板可用 `http://localhost:5173/?hostname=127.0.0.1&port=19999` 连接（URL 参数见 README）。
`test/verify.mjs` / `bench.mjs` 需要先 `pnpm build`，macOS 上要 `CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`；`verify.mjs` 在中文 locale 下第 8 项会失败（按 placeholder 找英文 "Search"），这是既有问题。
sing-box API 冒烟：`node test/mock-server.mjs --port 19998 --version 'sing-box 1.15.0-alpha.6-reF1nd-moonfruit.2'` 与 `node fork-test/mock-singbox-api.mjs --port 19999 --upstream 19998`，面板连 `127.0.0.1:19999`。

## 架构

分层：`api/`（纯请求函数）→ `assembly/`（组装层：后端判别、能力、driver、会话与各域状态）→ `components/` `views/` `composables/`（视图层）。`store/` 是本地持久化的设置与 UI 状态，`helper/` 是工具函数，`config/settings-items.ts` 是设置项注册表。

### 后端判别：backend type × core

- `Backend.type`（`src/types/index.d.ts`）是用户配置的协议：`'clash' | 'dae'`，由 `store/setup.ts` 持久化；注意其中的旧数据迁移会**删除** `type === 'singbox'` 的条目，所以 sing-box 不是一个独立 type。
- `core`（`assembly/backend.ts`）是运行时内核品牌，由 `assembly/version.ts` 探测 `/version` 得出：`Mihomo` / `Honk` / `Singbox` / `Dae` / `Unknown`。sing-box 还细分变体 `official` / `refind` / `moonfruit`（`assembly/singbox/variant.ts`，匹配 `-reF1nd`、`-moonfruit`）。
- `assembly/session.ts` 的 `startBackendSession` 在切换后端时先 `await probeActiveBackend()`，再建立连接 / 日志 / 统计等常驻流，所以建流时 `core` 已确定。

### 能力表 `can()`

视图层只能通过 `can(cap)`（`assembly/backend.ts`）决定显隐和行为，eslint 禁止视图层导入 `core` / `resetCore`、`@/api`、`@/api/clash`。能力表按 type / core 选择：dae 用 `/capabilities` 结果，sing-box 用 `singboxCaps(variant, forkOverride)`（`assembly/singbox/capabilities.ts`），其余用 `clashCaps`。新增能力要加进 `Cap` 联合类型。
`displayAllFeatures` 设置只在 honk / sing-box 内核下出现，用于放开 `mihomoOrForkCore` 那一组。能由响应数据自证的差异（如规则开关按 `rule.uuid` 选端点）不进能力表。

### Driver

`assembly/driver/types.ts` 定义 `Driver`（system / metrics / proxies / rules / config / logs / connections 等子接口）。`driverFor(backend)` 按 type 选 `clashDriver` / `daeDriver`；`driver()` 在 `core === Singbox` 时返回 `singboxDriver`（`clashDriver` 的展开，按需覆盖方法，是将来接入 sing-box gRPC API 的锚点）。各域门面（`assembly/proxies`、`connections.ts`、`logs.ts` 等）都经 `driver()` 调后端。

### fork 自有的 sing-box 支持

集中在 `src/assembly/singbox/`（variant、capabilities、logs、mode、global-node）和 `src/assembly/driver/singbox.ts`，上游文件只留挂接点。设计与能力矩阵的依据见 `docs/superpowers/specs/2026-09-24-singbox-restore-design.md`；判断 sing-box 端点是否存在时以本地 sing-box 源码（官方 / ref1nd / moonfruit 三个 ref 的 `experimental/clashapi`）为准，不要凭记忆。

### 其他约定

- HTTP 走全局 axios 拦截器（`api/http.ts`）：baseURL 与 `Authorization: Bearer <password>` 取自当前后端，401 会打开后端编辑。WebSocket 流用 `createClashWebSocket`。
- 持久化用 `composables/use-storage.ts`（包装 vueuse，`writeDefaults: false`）；字符串值以原文存进 localStorage，不是 JSON。
- 设置页的每一项在 `config/settings-items.ts` 注册 key，组件里用 `SettingItem` + `useIsSettingVisible`，用户可单独隐藏。
- i18n 有 `zh` / `zh-tw` / `en` / `ru` 四份（`src/i18n/`），新增文案要四份一起加。
- 构建时 `APP_VERSION` / `APP_REPO` 覆盖显示版本与更新检查仓库（默认 `moonfruit/zashboard`）。
