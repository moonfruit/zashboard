# 恢复 sing-box 支持（Clash API）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Clash API 上恢复 sing-box 内核的专属处理，自动识别官方 / ref1nd / moonfruit 三种变体，并在结构上为将来同端口的 gRPC API 预留接入点。

**Architecture:** 沿用上游 `core` 轴：`/version` 含 `sing-box` 时判为 `Core.Singbox`，同时识别变体；`can()` 在 sing-box 内核下改查纯函数 `singboxCaps(variant, forkOverride)`；`driver()` 在 sing-box 内核下返回 `singboxDriver`（`clashDriver` 的展开，作为将来 gRPC 的锚点）。UI 侧照删除前（`4adb4872^`）的逻辑按当前代码结构恢复，统一以 `can('xxx')` 门控。

**Tech Stack:** Vue 3 + TypeScript + Vite，pnpm；纯函数测试用 Node 26 自带的 `node --test`（原生 TS 类型擦除，无需新依赖）。

**Spec:** `docs/superpowers/specs/2026-09-24-singbox-restore-design.md`

## Global Constraints

- 在 `feat/singbox` 分支上工作（已从 `moonfruit` 拉出，spec 已提交为 `558b3966`）。
- fork 自有逻辑放新文件；对上游文件只做小挂接点；不复制 `clashDriver` 的实现。
- 不改 `package.json` / `pnpm-lock.yaml`，不新增依赖。
- 不新增 `BackendType`，不改 `src/store/setup.ts`。
- 代码风格跟随上游：**不写注释**，2 空格缩进，单引号，无分号（prettier 配置已在仓库中，提交时 husky 会跑 lint-staged + `vue-tsc`）。
- `src/assembly/singbox/*.ts` 只能有 **type-only** 的相对导入和 `vue` 导入，不能用 `enum`，这样 `node --test` 才能直接加载（Node 原生类型擦除不支持 enum，也不解析无扩展名的相对路径；`import type` 会被擦除所以不受影响）。
- 能力矩阵与变体判定规则以 spec 为准，照抄，不自行增删。
- 提交信息用 conventional commits（`feat:` / `test:` 等），不加署名行。

对 spec 的两处实现细化（不改变行为）：

1. spec 写的是 `SingboxVariant` 枚举，这里改用字符串字面量联合类型 `'official' | 'refind' | 'moonfruit'`，原因见上面「不能用 enum」。
2. spec 写的是 `singboxVariant` computed。为避免 `backend.ts → variant → version.ts → backend.ts` 的循环依赖，改为 `variant.ts` 持有 `ref`，由 `version.ts` 在写入 `core` 的同一处写入，并由 `resetCore()` 一并清空。

## Review Focus

1. 日志 payload 没有 `tag: ` 前缀（如 `sing-box started (0.12s)`）时，类型下拉框里不能出现空字符串选项；空值会和「全部」（`value: ''`）撞在一起。由 Task 1 的 `getSingboxLogType` 测试和 Task 3 的跳过空值逻辑覆盖。
2. 从 sing-box 后端切到 mihomo / honk / dae 后端时，变体、能力表和 driver 必须全部回到非 sing-box 的状态，不能残留上一个后端的变体。由 Task 2 的 `resetCore` 清空变体覆盖，并在 Task 2 的手工验证中切换后端检查。
3. 版本串的各种写法都要判对：`-reF1nd.2-moonfruit.2` 判为 moonfruit，大小写不同的 `-ref1nd` 判为 refind，`1.14.0-beta.17` 判为 official。由 Task 1 的测试覆盖。
4. 从 honk 时代遗留的 `displayAllFeatures = true`：连上官方 sing-box 后，只放开 `mihomoOrForkCore` 那一组，`proxyProviderUpdate` 等 ref1nd 专属能力不能被放开。由 Task 1 的测试覆盖。
5. `customGlobalNode` 里存的节点名在当前后端不存在（换了后端或配置）时，必须回退到 `GLOBAL`，不能渲染空组。由 Task 4 的实现（`proxyMap` 存在性检查）和手工验证覆盖。

---

## File Structure

| 文件 | 类型 | 职责 |
|---|---|---|
| `src/assembly/singbox/variant.ts` | 新建 | `SingboxVariant` 类型、`detectSingboxVariant()`、`singboxVariant` ref |
| `src/assembly/singbox/capabilities.ts` | 新建 | `singboxCaps(variant, forkOverride)` 能力矩阵 |
| `src/assembly/singbox/logs.ts` | 新建 | `getSingboxLogType()`、`getLogConnectionID()` 两个日志解析纯函数 |
| `src/assembly/driver/singbox.ts` | 新建 | `singboxDriver`，sing-box 后端行为的唯一锚点 |
| `src/assets/images/sing-box.svg` | 新建（从 git 历史恢复） | 内核 logo |
| `test/singbox.test.mjs` | 新建 | 上面三个纯函数模块的 `node --test` 测试 |
| `src/assembly/backend.ts` | 修改 | `Core.Singbox`、Cap 联合类型、`soft` 选表、`isNonMihomoCore`、`resetCore` |
| `src/assembly/version.ts` | 修改 | `detectCore` 识别 sing-box、写入变体、`coreBrand` |
| `src/assembly/driver/index.ts` | 修改 | `driver()` 在 sing-box 内核下返回 `singboxDriver` |
| `src/assembly/logs.ts` | 修改 | `extraLogLevels` |
| `src/components/controls/LogsCtrl.tsx` | 修改 | sing-box 日志类型提取 |
| `src/components/logs/LogsCard.vue`、`LogsTable.vue`、`src/views/LogsPage.vue` | 修改 | 同连接日志 |
| `src/components/controls/ProxiesCtrl.tsx` | 修改 | 切模式断开 `clash_mode` 连接 |
| `src/store/settings.ts`、`src/config/settings-items.ts`、`src/helper/proxies.ts`、`src/components/settings/proxies/ProxiesSettings.vue` | 修改 | 自定义全局节点 |
| `src/i18n/{zh,zh-tw,en,ru}.ts` | 修改 | `sameConnectionLogs`、`customGlobalNode`、`displayAllFeaturesTip` |
| `test/mock-server.mjs` | 修改 | `version` 参数、sing-box 风格 `/logs` WS |

日志解析函数放在 `src/assembly/singbox/logs.ts`，而不是 spec 里写的 `src/store/logs.ts`：`store/logs.ts` 导入了 `@/composables/use-storage`，`node --test` 解析不了 `@/` 别名；把纯函数放到 fork 自有目录里也更符合「新逻辑放新文件」。组件照常可以从 `@/assembly/singbox/logs` 导入（eslint 只限制导入 `@/assembly/backend` 的 `core` / `resetCore`）。

---

### Task 1: sing-box 纯函数模块（变体、能力矩阵、日志解析）

**Files:**
- Create: `src/assembly/singbox/variant.ts`
- Create: `src/assembly/singbox/capabilities.ts`
- Create: `src/assembly/singbox/logs.ts`
- Test: `test/singbox.test.mjs`

**Interfaces:**
- Consumes: `import type { Cap } from '../backend'`（已有的 Cap 联合类型；Task 2 会往里加 5 个成员，本任务先用 `Partial<Record<Cap, boolean>>` 作返回类型，新增的 5 个键在 Task 2 之前会让 `vue-tsc` 报「对象字面量只能指定已知属性」，所以 **本任务的 Step 3 同时往 `Cap` 联合类型里加这 5 个成员**，其余 backend 改动留给 Task 2）
- Produces:
  - `type SingboxVariant = 'official' | 'refind' | 'moonfruit'`
  - `detectSingboxVariant(version: string): SingboxVariant`
  - `singboxVariant: Ref<SingboxVariant | undefined>`
  - `singboxCaps(variant: SingboxVariant, forkOverride: boolean): Partial<Record<Cap, boolean>>`
  - `getSingboxLogType(payload: string): string`：返回形如 `router:`（带冒号）的类型，没有 `tag: ` 前缀时返回 `''`
  - `getLogConnectionID(payload: string): string | null`

- [ ] **Step 1: 写失败的测试**

创建 `test/singbox.test.mjs`：

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { singboxCaps } from '../src/assembly/singbox/capabilities.ts'
import { getLogConnectionID, getSingboxLogType } from '../src/assembly/singbox/logs.ts'
import { detectSingboxVariant } from '../src/assembly/singbox/variant.ts'

describe('detectSingboxVariant', () => {
  it('official', () => {
    assert.equal(detectSingboxVariant('sing-box 1.14.1'), 'official')
    assert.equal(detectSingboxVariant('sing-box 1.14.0-beta.17'), 'official')
  })

  it('refind', () => {
    assert.equal(detectSingboxVariant('sing-box 1.15.0-alpha.6-reF1nd'), 'refind')
    assert.equal(detectSingboxVariant('sing-box 1.15.0-alpha.6-reF1nd.2'), 'refind')
    assert.equal(detectSingboxVariant('sing-box 1.15.0-alpha.6-ref1nd'), 'refind')
  })

  it('moonfruit', () => {
    assert.equal(detectSingboxVariant('sing-box 1.15.0-alpha.6-reF1nd-moonfruit'), 'moonfruit')
    assert.equal(detectSingboxVariant('sing-box 1.15.0-alpha.6-reF1nd.2-moonfruit.2'), 'moonfruit')
  })
})

describe('singboxCaps', () => {
  const REFIND_ONLY = [
    'coreRestart',
    'reloadConfigs',
    'proxyProviderUpdate',
    'proxyProviderHealthCheck',
    'ruleProviders',
  ]
  const ALWAYS = [
    'dashboardUpgrade',
    'independentLatency',
    'traceLogLevel',
    'silentLogLevel',
    'extraLogLevels',
    'customGlobalNode',
    'logTypeFilter',
    'logConnectionDetail',
    'disconnectOnModeChange',
    'latencyTest',
    'nodeLatencyTest',
    'customTestUrl',
    'dnsQuery',
    'flushDNSCache',
    'flushFakeIP',
    'connectionsClose',
  ]
  const NEVER = ['coreUpdateCheck', 'configPatch', 'runtimeStats']
  const OVERRIDE_ONLY = ['coreUpgrade', 'updateConfigs', 'updateGeoDatabase', 'syncSettings']

  for (const variant of ['official', 'refind', 'moonfruit']) {
    it(`${variant} matrix`, () => {
      const caps = singboxCaps(variant, false)

      for (const cap of ALWAYS) assert.equal(caps[cap], true, cap)
      for (const cap of REFIND_ONLY) assert.equal(caps[cap] === true, variant !== 'official', cap)
      for (const cap of [...NEVER, ...OVERRIDE_ONLY]) assert.notEqual(caps[cap], true, cap)
    })
  }

  it('forkOverride unlocks the mihomoOrForkCore group only', () => {
    const caps = singboxCaps('official', true)

    for (const cap of [...OVERRIDE_ONLY, 'coreRestart', 'reloadConfigs']) {
      assert.equal(caps[cap], true, cap)
    }
    for (const cap of ['proxyProviderUpdate', 'proxyProviderHealthCheck', 'ruleProviders', ...NEVER]) {
      assert.notEqual(caps[cap], true, cap)
    }
  })
})

describe('sing-box log parsing', () => {
  it('extracts tag type with connection prefix', () => {
    assert.equal(getSingboxLogType('[3829292130 5ms] router: match[0] => direct'), 'router:')
  })

  it('extracts tag type without connection prefix', () => {
    assert.equal(
      getSingboxLogType('inbound/tun[tun-in]: started at utun9'),
      'inbound/tun[tun-in]:',
    )
  })

  it('returns empty type when no tag', () => {
    assert.equal(getSingboxLogType('sing-box started (0.12s)'), '')
    assert.equal(getSingboxLogType('[42 1ms] closed'), '')
  })

  it('extracts connection id', () => {
    assert.equal(getLogConnectionID('[3829292130 5ms] router: match[0]'), '3829292130')
    assert.equal(getLogConnectionID('[3829292130 1.2s] outbound/vless[proxy]: x'), '3829292130')
  })

  it('returns null without connection prefix', () => {
    assert.equal(getLogConnectionID('router: updated'), null)
    assert.equal(getLogConnectionID('[warn] something'), null)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/singbox.test.mjs`
Expected: FAIL，报 `ERR_MODULE_NOT_FOUND`（`src/assembly/singbox/capabilities.ts` 不存在）

- [ ] **Step 3: 实现**

`src/assembly/singbox/variant.ts`：

```ts
import { ref } from 'vue'

export type SingboxVariant = 'official' | 'refind' | 'moonfruit'

export const detectSingboxVariant = (version: string): SingboxVariant => {
  if (/-moonfruit\b/i.test(version)) return 'moonfruit'
  if (/-ref1nd\b/i.test(version)) return 'refind'
  return 'official'
}

export const singboxVariant = ref<SingboxVariant>()
```

`src/assembly/singbox/capabilities.ts`：

```ts
import type { Cap } from '../backend'
import type { SingboxVariant } from './variant'

export const singboxCaps = (
  variant: SingboxVariant,
  forkOverride: boolean,
): Partial<Record<Cap, boolean>> => {
  const refind = variant !== 'official'

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
    silentLogLevel: true,
    extraLogLevels: true,

    customGlobalNode: true,
    logTypeFilter: true,
    logConnectionDetail: true,
    disconnectOnModeChange: true,

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
  }
}
```

`src/assembly/singbox/logs.ts`：

```ts
export const getSingboxLogType = (payload: string) => {
  const start = payload.startsWith('[') ? payload.indexOf(']') + 2 : 0
  const end = payload.indexOf(': ', start)

  return end === -1 ? '' : payload.slice(start, end + 1)
}

export const getLogConnectionID = (payload: string) =>
  payload.match(/^\[(\d+)\s[^\]]*\]/)?.[1] ?? null
```

同一步里在 `src/assembly/backend.ts` 的 `export type Cap =` 联合类型末尾（`| 'lifecycleControl'` 之后）追加：

```ts
  | 'extraLogLevels'
  | 'customGlobalNode'
  | 'logTypeFilter'
  | 'logConnectionDetail'
  | 'disconnectOnModeChange'
```

注意 `getSingboxLogType('[42 1ms] closed')`：`start` 为 `]` 后两位，`indexOf(': ', start)` 为 -1，返回 `''`，符合测试。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/singbox.test.mjs`
Expected: PASS，全部用例通过

Run: `pnpm type-check`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add src/assembly/singbox test/singbox.test.mjs src/assembly/backend.ts
git commit -m "feat(singbox): add variant detection, capability matrix and log parsing"
```

---

### Task 2: 接入 core 轴、能力表与 driver

**Files:**
- Create: `src/assembly/driver/singbox.ts`
- Create: `src/assets/images/sing-box.svg`（从 `4adb4872^` 恢复）
- Modify: `src/assembly/backend.ts`
- Modify: `src/assembly/version.ts`
- Modify: `src/assembly/driver/index.ts`
- Modify: `src/assembly/logs.ts:16-22`
- Modify: `src/i18n/{zh,zh-tw,en,ru}.ts`（`displayAllFeaturesTip`）
- Modify: `test/mock-server.mjs`（`version` 参数）

**Interfaces:**
- Consumes: Task 1 的 `singboxVariant`、`detectSingboxVariant`、`singboxCaps`、`SingboxVariant`
- Produces:
  - `Core.Singbox = 'singbox'`
  - `singboxDriver: Driver`
  - `createMockServer({ version })` 与 CLI `--version`：`/version` 返回 `{ version, meta: true }`

- [ ] **Step 1: mock server 支持自定义版本串**

`test/mock-server.mjs` 中：

`createMockServer` 的参数解构加 `version = 'v1.19.0',`（放在 `providers: providerCount = 4,` 之后）。

把
```js
    if (pathname === '/version') return json(res, { version: 'v1.19.0', meta: true })
```
改为
```js
    if (pathname === '/version') return json(res, { version, meta: true })
```

CLI 部分 `parseArgs` 的 `options` 里加 `version: { type: 'string', default: 'v1.19.0' },`，`createMockServer({...})` 调用里加 `version: values.version,`，启动日志改为：
```js
  console.log(
    `mock clash api → ${mock.url}  (version=${values.version} groups=${values.groups} nodes=${values.nodes} conns=${values.conns})`,
  )
```

- [ ] **Step 2: 手工确认当前行为（修改前基线）**

```bash
node test/mock-server.mjs --port 9999 --version 'sing-box 1.15.0-alpha.6-reF1nd-moonfruit' &
pnpm dev
```

浏览器打开 dev 地址，后端填 `http://127.0.0.1:9999`。预期（修改前）：内核 logo 显示为 MetaCubeX，设置里能看到「更新内核」等 mihomo 专属项。这证明当前 sing-box 会被当作 mihomo。记下后关闭 dev server（mock 可以留着）。

- [ ] **Step 3: 恢复 logo**

```bash
git show '4adb4872^:src/assets/images/sing-box.svg' > src/assets/images/sing-box.svg
```

- [ ] **Step 4: 修改 `src/assembly/backend.ts`**

在导入处加：
```ts
import { singboxCaps } from './singbox/capabilities'
import { singboxVariant } from './singbox/variant'
```

`Core` 枚举在 `Dae = 'dae',` 之后加 `Singbox = 'singbox',`。

`resetCore` 改为：
```ts
export const resetCore = () => {
  core.value = Core.Unknown
  singboxVariant.value = undefined
}
```

`isNonMihomoCore` 改为：
```ts
const isNonMihomoCore = computed(
  () =>
    (core.value === Core.Honk || core.value === Core.Singbox) &&
    activeBackend.value?.type !== 'dae',
)
```

`soft` 改为：
```ts
const soft = computed<Caps>(() => {
  if (activeBackend.value?.type === 'dae') return daeCaps.value
  if (core.value === Core.Singbox) {
    return singboxCaps(singboxVariant.value ?? 'official', isForkCoreOverride.value)
  }
  return clashCaps.value
})
```

- [ ] **Step 5: 修改 `src/assembly/version.ts`**

导入加：
```ts
import SingBoxLogo from '@/assets/images/sing-box.svg'
import { detectSingboxVariant, singboxVariant } from './singbox/variant'
```

`detectCore` 在 honk 那行之后加：
```ts
  if (versionString.includes('sing-box')) return Core.Singbox
```

`probeBackendVersion` 中
```ts
  version.value = versionString
  core.value = detectCore(version.value)
```
之后加：
```ts
  singboxVariant.value =
    core.value === Core.Singbox ? detectSingboxVariant(version.value) : undefined
```

`coreBrand` 的 `switch` 在 `case Core.Dae:` 分支之后加：
```ts
    case Core.Singbox:
      return { logo: SingBoxLogo, url: 'https://github.com/SagerNet/sing-box' }
```

- [ ] **Step 6: 新建 `src/assembly/driver/singbox.ts`**

```ts
import { clashDriver } from './clash'
import type { Driver } from './types'

export const singboxDriver: Driver = {
  ...clashDriver,
}
```

- [ ] **Step 7: 修改 `src/assembly/driver/index.ts`**

改为：
```ts
import { core, Core } from '@/assembly/backend'
import { activeBackend } from '@/store/setup'
import type { Backend, BackendType } from '@/types'
import { clashDriver } from './clash'
import { daeDriver } from './dae'
import { singboxDriver } from './singbox'
import type { Driver } from './types'

const drivers: Record<BackendType, Driver> = {
  clash: clashDriver,
  dae: daeDriver,
}

export const driverFor = (backend?: Backend | null) =>
  drivers[backend?.type as BackendType] ?? clashDriver

export const driver = () => {
  const selected = driverFor(activeBackend.value)

  return selected === clashDriver && core.value === Core.Singbox ? singboxDriver : selected
}

export * from './types'
```

（`driverFor` 保持不变：它给 `probe.ts` 探测任意后端用，而 `core` 只描述当前激活的后端。）

- [ ] **Step 8: 修改 `src/assembly/logs.ts` 的 `supportedLogLevels`**

```ts
export const supportedLogLevels = computed(() => {
  const levels = [LOG_LEVEL.Debug, LOG_LEVEL.Info, LOG_LEVEL.Warning, LOG_LEVEL.Error]

  if (can('traceLogLevel')) levels.unshift(LOG_LEVEL.Trace)
  if (can('extraLogLevels')) levels.push(LOG_LEVEL.Fatal, LOG_LEVEL.Panic)
  if (can('silentLogLevel')) levels.push(LOG_LEVEL.Silent)

  return levels
})
```

- [ ] **Step 9: 更新 `displayAllFeaturesTip` 文案（四种语言）**

把各语言里的「（honk）」/「(honk)」改为包含 sing-box：

- `src/i18n/zh.ts`：`当前内核（honk）` → `当前内核（honk / sing-box）`
- `src/i18n/zh-tw.ts`：`目前核心（honk）` → `目前核心（honk / sing-box）`
- `src/i18n/en.ts`：`current core (honk)` → `current core (honk / sing-box)`
- `src/i18n/ru.ts`：`текущего ядра (honk)` → `текущего ядра (honk / sing-box)`

- [ ] **Step 10: 静态检查**

Run: `pnpm type-check && pnpm lint && node --test test/singbox.test.mjs`
Expected: 全部通过；`pnpm lint` 带 `--fix`，若改动了文件，检查 diff 后一并提交

- [ ] **Step 11: 手工验证（mock）**

分别用下面的版本串启动 mock（每次重启 mock，并在面板里刷新页面）：

```bash
node test/mock-server.mjs --port 9999 --version 'sing-box 1.14.1'
node test/mock-server.mjs --port 9999 --version 'sing-box 1.15.0-alpha.6-reF1nd'
node test/mock-server.mjs --port 9999 --version 'sing-box 1.15.0-alpha.6-reF1nd-moonfruit'
node test/mock-server.mjs --port 9999 --version 'v1.19.0'
```

`pnpm dev` 后检查：

| 版本 | 内核 logo | 后端设置 · 重启内核 / 重载配置 | 更新内核 | 日志级别下拉 | 通用设置 · 显示所有功能 |
|---|---|---|---|---|---|
| `sing-box 1.14.1` | sing-box | 隐藏 | 隐藏 | trace…error、fatal、panic、silent | 显示 |
| `…-reF1nd` | sing-box | 显示 | 隐藏 | 同上 | 显示 |
| `…-reF1nd-moonfruit` | sing-box | 显示 | 隐藏 | 同上 | 显示 |
| `v1.19.0`（mihomo） | MetaCubeX | 显示 | 显示 | debug…error、silent | 隐藏 |

再在 `sing-box 1.14.1` 下打开「显示所有功能」：重启内核、重载配置、更新内核出现。

最后验证 Review Focus 2：在面板里同时保留 sing-box（9999）和另一个 mock（`node test/mock-server.mjs --port 9998` 即 mihomo）两个后端，来回切换，logo 和上表各列都要跟着变，不能残留。

- [ ] **Step 12: 提交**

```bash
git add src/assembly src/assets/images/sing-box.svg src/i18n test/mock-server.mjs
git commit -m "feat(singbox): detect sing-box core and route capabilities and driver"
```

---

### Task 3: 日志：类型分面过滤与同连接日志

**Files:**
- Modify: `src/components/controls/LogsCtrl.tsx:1-78`
- Modify: `src/components/logs/LogsCard.vue`
- Modify: `src/components/logs/LogsTable.vue`
- Modify: `src/views/LogsPage.vue`
- Modify: `src/i18n/{zh,zh-tw,en,ru}.ts`（`sameConnectionLogs`）
- Modify: `test/mock-server.mjs`（`/logs` WS）

**Interfaces:**
- Consumes: Task 1 的 `getSingboxLogType`、`getLogConnectionID`（`@/assembly/singbox/logs`）；Task 2 让 `can('logTypeFilter')`、`can('logConnectionDetail')` 在 sing-box 下为真
- Produces: `LogsCard` 新 prop `connectionDetailDisabled?: boolean` 与 emit `connectionClick(connectionID: string)`；`LogsTable` 同名 emit

- [ ] **Step 1: mock server 推送日志**

`test/mock-server.mjs` 的 WS `setInterval` 回调里，在 `/memory` 分支之后加：

```js
        } else if (pathname.startsWith('/logs')) {
          const id = 1000 + (tick % 3)
          const payload = version.includes('sing-box')
            ? [
                `[${id} ${tick}ms] router: match[0] => direct`,
                `[${id} ${tick}ms] outbound/direct[direct]: outbound connection to example.com:443`,
                'sing-box started (0.12s)',
              ][tick % 3]
            : `[TCP] 127.0.0.1:${50000 + tick} --> example.com:443 match Match using DIRECT`
          socket.write(websocketFrame(JSON.stringify({ type: 'info', payload })))
```

（注意这是插在已有 `else if` 链中的，保持花括号配对：原来 `/memory` 分支的 `}` 后面接这段，这段的结尾仍由原来的 `}` 收尾。）

- [ ] **Step 2: 手工确认基线**

用 `--version 'sing-box 1.15.0-alpha.6-reF1nd'` 启动 mock，`pnpm dev`，进日志页。预期（修改前）：类型下拉里出现 `[1000`、`sing-box` 这类按空格切出来的错误类型，点日志没有反应。

- [ ] **Step 3: `LogsCtrl.tsx` 按 sing-box 格式提取类型**

导入加：
```ts
import { can } from '@/assembly/backend'
import { getSingboxLogType } from '@/assembly/singbox/logs'
```

`logFilterOptions` 的循环改为：
```ts
      for (const log of logs.value) {
        let type: string

        if (can('logTypeFilter')) {
          type = getSingboxLogType(log.payload)
        } else {
          const index = log.payload.indexOf(' ')
          type = index === -1 ? log.payload : log.payload.slice(0, index)
        }

        if (type && !types.includes(type)) {
          types.push(type)
        }

        if (!levels.includes(log.type)) {
          levels.push(log.type)
        }
      }
```

（`type &&` 保证不出现空选项，见 Review Focus 1。）

- [ ] **Step 4: `LogsCard.vue` 支持点击**

模板根元素改为：
```vue
  <div
    class="hover:bg-base-200/40 flex flex-col gap-1 px-3 py-2.5 text-sm transition-colors"
    :class="connectionID && 'cursor-pointer'"
    @click="connectionID && emits('connectionClick', connectionID)"
  >
```

`<script setup>` 改为：
```ts
import { can } from '@/assembly/backend'
import { getLogConnectionID } from '@/assembly/singbox/logs'
import HighlightText from '@/components/common/HighlightText.vue'
import { useBounceOnVisible } from '@/composables/use-bounce-on-visible'
import { LOG_LEVEL } from '@/constant'
import { logFilter } from '@/store/logs'
import type { LogWithSeq } from '@/types'
import { computed } from 'vue'

const props = defineProps<{
  log: LogWithSeq
  connectionDetailDisabled?: boolean
}>()

const emits = defineEmits<{
  (e: 'connectionClick', connectionID: string): void
}>()

const connectionID = computed(() => {
  if (!can('logConnectionDetail') || props.connectionDetailDisabled) return null

  return getLogConnectionID(props.log.payload)
})
```
（`seqWithPadding`、`colorMapForType`、`useBounceOnVisible()` 保持不变。）

- [ ] **Step 5: `LogsTable.vue` 支持行点击**

模板改为：
```vue
  <VirtualTable
    :data="logs"
    :columns="columns"
    sorting-key="config/logs-table-sorting"
    :estimate-size="36"
    table-class="table-fixed min-w-2xl"
    :row-class="rowClass"
    @row-click="handlerRowClick"
  />
```

`<script setup>` 导入加：
```ts
import { can } from '@/assembly/backend'
import { getLogConnectionID } from '@/assembly/singbox/logs'
```

`defineProps` 之后加：
```ts
const emits = defineEmits<{
  (e: 'connectionClick', connectionID: string): void
}>()

const connectionIDOf = (log: LogWithSeq) => {
  if (!can('logConnectionDetail')) return null

  return getLogConnectionID(log.payload)
}

const rowClass = (log: LogWithSeq) => (connectionIDOf(log) ? 'cursor-pointer' : undefined)

const handlerRowClick = (log: LogWithSeq) => {
  const connectionID = connectionIDOf(log)

  if (connectionID) {
    emits('connectionClick', connectionID)
  }
}
```

- [ ] **Step 6: `LogsPage.vue` 加同连接日志弹窗**

模板：`<LogsTable :logs="renderLogs" />` 改为
```vue
      <LogsTable
        :logs="renderLogs"
        @connection-click="handlerConnectionClick"
      />
```
`<LogsCard :log="item" />` 改为
```vue
        <LogsCard
          :log="item"
          @connection-click="handlerConnectionClick"
        />
```
在 `</VirtualScroller>` 之后、根 `</div>` 之前加：
```vue
    <DialogWrapper
      v-model="connectionLogsDialogVisible"
      no-padding
      :title="`${t('sameConnectionLogs')} (${connectionLogID})`"
    >
      <div class="bg-base-200 flex flex-col gap-2 p-2">
        <div
          v-for="log in connectionLogs"
          :key="log.seq"
          class="base-container"
        >
          <LogsCard
            :log="log"
            connection-detail-disabled
          />
        </div>
      </div>
    </DialogWrapper>
```

`<script setup>` 导入加：
```ts
import { getLogConnectionID } from '@/assembly/singbox/logs'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { useI18n } from 'vue-i18n'
```
并把 `import { computed } from 'vue'` 改为 `import { computed, ref } from 'vue'`。

在文件末尾（`renderLogs` 之后）加：
```ts
const { t } = useI18n()

const connectionLogID = ref('')
const connectionLogsDialogVisible = ref(false)
const connectionLogs = computed(() => {
  if (!connectionLogID.value) return []

  return logs.value
    .filter((log) => getLogConnectionID(log.payload) === connectionLogID.value)
    .reverse()
})

const handlerConnectionClick = (connectionID: string) => {
  connectionLogID.value = connectionID
  connectionLogsDialogVisible.value = true
}
```

- [ ] **Step 7: i18n `sameConnectionLogs`**

在各语言文件 `logType:` 那一行之后加：

- `src/i18n/zh.ts`：`  sameConnectionLogs: '同连接日志',`
- `src/i18n/zh-tw.ts`：`  sameConnectionLogs: '同連線日誌',`
- `src/i18n/en.ts`：`  sameConnectionLogs: 'Logs of the same connection',`
- `src/i18n/ru.ts`：`  sameConnectionLogs: 'Журналы одного соединения',`

- [ ] **Step 8: 静态检查**

Run: `pnpm type-check && pnpm lint && node --test test/singbox.test.mjs`
Expected: 全部通过

- [ ] **Step 9: 手工验证（mock）**

`--version 'sing-box 1.15.0-alpha.6-reF1nd'` 下，日志页：
- 类型下拉的「日志类型」组只有 `router:`、`outbound/direct[direct]:`，没有空项、没有 `[1000`
- 选 `router:` 只剩 router 日志
- 卡片模式和表格模式下（日志设置里切换），点带 `[1000 …]` 的日志都会弹出「同连接日志 (1000)」，里面只有 id 为 1000 的日志，且弹窗里的卡片点击无反应；`sing-box started` 这条不可点、无手型光标

`--version v1.19.0` 下：类型下拉按空格切分（出现 `[TCP]`），日志不可点击，和改动前一致。

- [ ] **Step 10: 提交**

```bash
git add src/components/controls/LogsCtrl.tsx src/components/logs src/views/LogsPage.vue src/i18n test/mock-server.mjs
git commit -m "feat(singbox): restore log type filter and same-connection logs"
```

---

### Task 4: 代理：切模式断开 clash_mode 连接与自定义全局节点

**Files:**
- Modify: `src/components/controls/ProxiesCtrl.tsx:1-96`
- Modify: `src/store/settings.ts`
- Modify: `src/config/settings-items.ts:368-372`
- Modify: `src/helper/proxies.ts:1-54`
- Modify: `src/components/settings/proxies/ProxiesSettings.vue`
- Modify: `src/i18n/{zh,zh-tw,en,ru}.ts`（`customGlobalNode`）

**Interfaces:**
- Consumes: Task 2 让 `can('disconnectOnModeChange')`、`can('customGlobalNode')` 在 sing-box 下为真；已有的 `activeConnections`、`disconnectById`、`connectionAccessor`（`@/assembly/connections`）
- Produces: `customGlobalNode: Ref<string>`（`@/store/settings`，存储键 `config/custom-global-node-name`，默认 `GLOBAL`）

- [ ] **Step 1: `ProxiesCtrl.tsx` 切模式时断开**

导入加：
```ts
import { activeConnections, connectionAccessor, disconnectById } from '@/assembly/connections'
```
（`can` 与 `automaticDisconnection` 已导入。）

`handlerModeChange` 改为：
```ts
    const handlerModeChange = (mode: string) => {
      updateConfigs({ mode })
      if (can('disconnectOnModeChange') && automaticDisconnection.value) {
        const accessor = connectionAccessor()

        activeConnections.value.forEach((connection) => {
          if (accessor.rule(connection).includes('clash_mode')) {
            disconnectById(connection.id).catch(() => {})
          }
        })
      }
    }
```

- [ ] **Step 2: `store/settings.ts` 恢复存储项**

`from '@/constant'` 的导入列表里按字母序加 `GLOBAL,`（放在 `FONTS,` 之后、`GEOIP_ASN_DATABASE_URL,` 之前）。

在 `export const displayGlobalByMode = ...` 那一行之后加：
```ts
export const customGlobalNode = useStorage('config/custom-global-node-name', GLOBAL)
```

- [ ] **Step 3: `settings-items.ts` 注册设置项**

在 `displayGlobalByMode` 项（`key: \`${SETTINGS_MENU_KEY.proxies}.displayGlobalByMode\``）的对象之后加：
```ts
      {
        key: `${SETTINGS_MENU_KEY.proxies}.customGlobalNode`,
        label: 'customGlobalNode',
        section: 'settingsSectionProxyDisplay',
      },
```

- [ ] **Step 4: `helper/proxies.ts` 使用自定义全局节点**

导入加 `import { can } from '@/assembly/backend'`，并把 `import { displayGlobalByMode, manageHiddenGroup } from '@/store/settings'` 改为
```ts
import { customGlobalNode, displayGlobalByMode, manageHiddenGroup } from '@/store/settings'
```

`getRenderProxyGroups` 中
```ts
    if (configs.value?.mode.toUpperCase() === GLOBAL) {
      return filterProxyGroups(getProxyGroupChains(GLOBAL), false)
    }
```
改为
```ts
    if (configs.value?.mode.toUpperCase() === GLOBAL) {
      const globalName =
        can('customGlobalNode') && proxyMap.value[customGlobalNode.value]
          ? customGlobalNode.value
          : GLOBAL

      return filterProxyGroups(getProxyGroupChains(globalName), false)
    }
```

- [ ] **Step 5: `ProxiesSettings.vue` 加设置 UI**

模板：在 `<SettingItem :setting-key="k.displayGlobalByMode">…</SettingItem>` 之后加：
```vue
        <SettingItem
          :setting-key="k.customGlobalNode"
          :when="displayGlobalByMode && can('customGlobalNode')"
          class="settings-dependent-item"
        >
          <div class="setting-item-label">
            {{ $t('customGlobalNode') }}
          </div>
          <SelectInput
            class="select select-sm w-32"
            v-model="customGlobalNode"
            :options="Object.keys(proxyMap).map((value) => ({ value, label: value }))"
          />
        </SettingItem>
```

`<script setup>`：
- 加 `import { proxyMap } from '@/assembly/proxies'`
- `from '@/store/settings'` 的列表里加 `customGlobalNode,`（放在 `displayGlobalByMode,` 之前）
- 在 `const isVisibleDisplayGlobalByMode = ...` 之后加 `const isVisibleCustomGlobalNode = useIsSettingVisible(k.customGlobalNode)`
- `hasVisibleProxyStyleItems` 改为：
```ts
const hasVisibleProxyStyleItems = computed(() => {
  return (
    isVisibleTwoColumnProxyGroup.value ||
    isVisibleProxyFolderMode.value ||
    isVisibleTruncateProxyName.value ||
    isVisibleDisplayGlobalByMode.value ||
    (displayGlobalByMode.value && can('customGlobalNode') && isVisibleCustomGlobalNode.value) ||
    isVisibleProxyPreviewType.value ||
    isVisibleProxyCardSize.value
  )
})
```

- [ ] **Step 6: i18n `customGlobalNode`**

在各语言文件 `displayGlobalByMode:` 那一行之后加：

- `src/i18n/zh.ts`：`  customGlobalNode: '自定义全局节点',`
- `src/i18n/zh-tw.ts`：`  customGlobalNode: '自訂全域節點',`
- `src/i18n/en.ts`：`  customGlobalNode: 'Custom global node',`
- `src/i18n/ru.ts`：`  customGlobalNode: 'Пользовательский глобальный узел',`

- [ ] **Step 7: 静态检查**

Run: `pnpm type-check && pnpm lint && node --test test/singbox.test.mjs`
Expected: 全部通过

- [ ] **Step 8: 手工验证（mock）**

`--version 'sing-box 1.15.0-alpha.6-reF1nd'` 下：
- 设置 · 代理：打开「根据模式显示 GLOBAL」后出现「自定义全局节点」下拉，关闭后消失；在设置项隐藏管理里能单独隐藏它
- 选一个组（如 `Group-001`），代理页切到 global 模式，显示的是 `Group-001` 的链而不是 `GLOBAL`
- Review Focus 5：浏览器 devtools 执行 `localStorage.setItem('config/custom-global-node-name', JSON.stringify('NOT-EXIST'))` 后刷新，global 模式下回退显示 `GLOBAL`，页面无报错（`useStorage` 的序列化方式以 devtools 里该键现有的值格式为准，若现值不是 JSON 字符串就直接写 `NOT-EXIST`）

`--version v1.19.0` 下：「自定义全局节点」不出现，global 模式显示 `GLOBAL`。

切模式断开需要真实连接数据中 `rule` 含 `clash_mode`，mock 数据不含，留到 Task 5 用真实 sing-box 验证。

- [ ] **Step 9: 提交**

```bash
git add src/components/controls/ProxiesCtrl.tsx src/store/settings.ts src/config/settings-items.ts src/helper/proxies.ts src/components/settings/proxies/ProxiesSettings.vue src/i18n
git commit -m "feat(singbox): restore mode-change disconnection and custom global node"
```

---

### Task 5: 整体验证

**Files:** 无代码改动；若发现问题，在对应任务的文件中修复并单独提交。

- [ ] **Step 1: 全量静态检查与构建**

Run: `pnpm type-check && pnpm lint && pnpm build && node --test test/singbox.test.mjs`
Expected: 全部通过；`git status` 干净（lint `--fix` 没有留下未提交改动）

- [ ] **Step 2: 已有冒烟测试回归**

Run: `node test/verify.mjs`
Expected: 全部 ✓（它用的是 mihomo 版本串，验证 mock 改动没有破坏原有流程）

- [ ] **Step 3: 真实内核验证**

用本地 sing-box 源码（`~/Workspace.localized/go/mod/sing-box`）按需构建或使用已有二进制，配置开启 `experimental.clash_api`，分别用官方（`origin/testing`）、ref1nd（`v1.15.0-alpha.6-reF1nd`）、moonfruit（`moonfruit` 分支）三种版本跑，`pnpm dev` 连上后逐项核对：

- Task 2 Step 11 的表格
- ref1nd / moonfruit：重启内核、重载配置可用；proxy provider 更新和健康检查可用；规则页 rule providers 可见；规则开关（`PUT /rules/{uuid}`）可用
- 官方：providers 相关入口不出现
- 日志：真实 sing-box 日志的类型下拉与同连接日志
- 切模式：开启「切换节点时自动断开连接」，在命中 `clash_mode` 规则的连接存在时切换模式，这些连接被断开，其他连接保留
- 日志级别切到 fatal / panic / silent 后 WS 不报错、不无限重连

- [ ] **Step 4: 回归 mihomo 与 dae**

若本地有 mihomo 或 dae 实例，连上后确认行为与 `moonfruit` 分支一致（logo、设置项、日志级别、代理页）。没有的话以 mock `v1.19.0` 的验证为准，并在交付说明里注明没做 dae 实机回归。
