# sing-box 工具页重做 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 sing-box 工具页从“一个长页面堆卡片”改为上游旧版的顶部 tab 结构（网络 / Tailscale / OpenVPN / OpenConnect / eBPF），内容用设置页的行列表样式，详情用对话框。

**Architecture:** 页面层用 `useToolsAvailability()` 统一订阅状态流并计算可见 tab（纯函数 `visibleTabs`），各 tab 组件只接收 props 渲染。组件以上游 `4adb4872^` 的 `src/components/tools/*` 为蓝本移植，数据改为来自 `src/assembly/singbox/tools/*` 的视图类型，不再直接用 protobuf 消息和 gRPC 客户端。

**Tech Stack:** Vue 3 + TypeScript，daisyUI，现有通用组件 `CtrlsBar`、`SegmentedControl`、`DialogWrapper`、`SelectInput`、`TimeSeriesChart`（`src/components/charts/chart-types.ts`、`chart-tooltip.ts`），`uqr`，vitest（`fork-test/`）。

**Spec:** `docs/superpowers/specs/2026-09-25-singbox-api-design.md` 的“工具页”一节（2026-09-25 修订版）。

## Global Constraints

- 新逻辑放新文件；上游文件只加最少的挂接点；不格式化、不重构上游代码；不写注释（移植上游组件时删掉其中的注释）。
- 视图层（`src/components/**`、`src/views/**`、`src/composables/**`）不得导入 `@/assembly/singbox/api/{client,runtime,gen/*}`，只通过 `@/assembly/singbox/tools/*` 门面和 `can()` 访问数据（eslint 已强制）。
- 主 chunk 不得出现 gRPC 客户端代码：`pnpm build` 后 `rg -l "grpc-websockets|application/grpc-web" dist/assets/index-*.js` 必须无匹配；工具页必须仍是懒加载 chunk。
- int64 在门面里已转成 `number`；`keyExpiry`、`lastSeen`、`connectedSince`、`deadline` 都是 Unix 秒。
- 服务端给的 URL 只允许 http/https（门面里已用 `safeHttpUrl` 处理，新代码不得绕过）。
- 新文案只加到 `src/i18n/singbox/{en,zh,zh-tw,ru}.ts`，四份同时加；需要的文案优先取上游旧版同名键的翻译：`git show '4adb4872^:src/i18n/<lang>.ts'`。已经存在于上游当前 i18n 的键直接复用，不重复定义。
- 上游旧版组件是 MIT、同一技术栈，可以移植；sing-box-dashboard 是 GPL，只借鉴设计，不复制代码。
- Taildrop、SSH、USB/IP 不做：移植时删掉相关按钮、对话框、导入和状态。
- 每个任务结束都要通过：`pnpm type-check`、`pnpm exec eslint .`、`pnpm -C fork-test type-check`、`pnpm -C fork-test test`（输出无多余 stderr）、`pnpm build` 与上面的主 chunk 检查。
- 提交会触发 husky pre-commit（type-check、eslint --fix、prettier --write），提交后用 `git show --stat HEAD` 确认。

## Review Focus

- 在工具页切换后端：可见 tab 要随新后端更新，停留在一个已不可见的 tab 时要回到“网络”（Task 2 的 `resolveActiveTab` 覆盖）。
- 能力为真但没有任何端点（例如配了 Tailscale 能力、但配置里没有 Tailscale endpoint）：不显示该 tab，也不能因为订阅失败刷屏（Task 2 的 `visibleTabs` 覆盖）。
- 状态流出错但之前出现过端点：tab 保留，并在 tab 顶部显示错误，而不是整页消失（Task 2 的 `visibleTabs` 以“是否见过端点”为准，覆盖）。
- peer 密钥即将过期和已经过期的边界（Task 1 的 `expiryState` 覆盖）。
- 网络质量进度消息里 `elapsedMs` 不单调，或者重复到达：曲线不能回退或出现重复点（Task 1 的 `appendThroughput` 覆盖）。

---

## 文件结构

| 路径 | 职责 | 任务 |
|---|---|---|
| `src/assembly/singbox/tools/tailscale.ts` | 补 `keyAuth`、`shareeNode`、`peerRelay`、`derpRegionID`；新增 `expiryState`、`pingPath` | 1 |
| `src/assembly/singbox/tools/network-quality.ts` | 新增 `ThroughputPoint`、`appendThroughput` | 1 |
| `src/assembly/singbox/tools/stun.ts` | 新增 `natTone` | 1 |
| `src/assembly/singbox/tools/vpn.ts` | 新增 `deadlineIn` | 1 |
| `src/assembly/singbox/tools/common.ts` | 新增 `OutboundOption`、`outboundOptions` | 1 |
| `src/assembly/singbox/tools/tabs.ts` | 纯函数 `visibleTabs`、`resolveActiveTab`，类型 `ToolsTab` | 2 |
| `src/assembly/singbox/tools/availability.ts` | `useToolsAvailability()`：按能力订阅三条状态流、拉取 eBPF、算可见 tab | 2 |
| `src/components/singbox/tools/PingSparkline.vue`、`QRCodeView.vue` | 从上游移植 | 2 |
| `src/components/singbox/tools/OutboundPickerDialog.vue` | 可搜索的出站选择对话框（新写） | 2 |
| `src/views/ToolsPage.vue` | tab 骨架 | 2 |
| `src/components/singbox/tools/NetworkToolsPanel.vue` | 网络 tab（移植） | 3 |
| `src/components/singbox/tools/TailscalePanel.vue`、`TailscalePeerDialog.vue`、`TailscaleExitNodeDialog.vue` | Tailscale tab（移植） | 4 |
| `src/components/singbox/tools/OpenVPNPanel.vue`、`OpenVPNAuthForm.vue`、`OpenConnectPanel.vue`、`OpenConnectAuthForm.vue`、`VpnTunnelRows.vue` | VPN tab（移植加新写） | 5 |
| `src/components/singbox/tools/EbpfPanel.vue` | eBPF tab（新写） | 6 |
| 旧组件 `ToolSection`、`StatCell`、`OutboundSelect`、`NetworkQualityCard`、`StunCard`、`TailscaleCard`、`TailscaleEndpoint`、`TailscalePeer`、`OpenVPNCard`、`OpenConnectCard`、`VpnTunnel`、`EbpfCard` | 删除 | 6 |

---

### Task 1: 门面补字段与纯函数

**Files:**
- Modify: `src/assembly/singbox/tools/tailscale.ts`, `network-quality.ts`, `stun.ts`, `vpn.ts`, `common.ts`
- Test: `fork-test/singbox/api/tools-redesign.test.ts`（新）；`fork-test/singbox/api/tailscale.test.ts`（补断言）

**Interfaces:**
- Produces:
  - `TailscaleEndpointView.keyAuth: boolean`；`TailscalePeerView.shareeNode: boolean`；`TailscalePingSample.peerRelay: string`、`.derpRegionID: number`
  - `EXPIRY_SOON_SECONDS = 30 * 24 * 3600`；`type ExpiryState = 'expired' | 'soon' | 'ok'`；`expiryState(peer: Pick<TailscalePeerView, 'keyExpiry' | 'expired'>, nowSeconds: number): ExpiryState`
  - `type PingPath = 'direct' | 'relay' | 'derp' | 'unknown'`；`pingPath(sample: Pick<TailscalePingSample, 'isDirect' | 'peerRelay' | 'derpRegionID' | 'derpRegionCode'>): PingPath`
  - `type ThroughputPoint = { elapsedMs: number; downloadMbps: number; uploadMbps: number }`；`THROUGHPUT_HISTORY = 120`；`appendThroughput(history: ThroughputPoint[], result: Pick<NetworkQualityResult, 'elapsedMs' | 'downloadMbps' | 'uploadMbps'>): ThroughputPoint[]`
  - `type NatTone = 'good' | 'fair' | 'poor' | 'unknown'`；`natTone(behavior: NatBehavior): NatTone`
  - `deadlineIn(challenge: Pick<OpenVPNChallengeView, 'deadline'>, nowSeconds: number): number | undefined`（剩余秒数，最小 0；`deadline` 为 0 时返回 undefined）
  - `type OutboundOption = { tag: string; type: string; delay: number | undefined }`；`outboundOptions: ComputedRef<OutboundOption[]>`（来自 `proxyMap`，去掉 `GLOBAL`，按 tag 排序；`delay` 取 `history` 最后一条的 `delay`，为 0 或没有时是 undefined）

- [ ] **Step 1: 写失败的测试**

`fork-test/singbox/api/tools-redesign.test.ts`：

```ts
import { proxyMap } from '@/assembly/proxies'
import { outboundOptions } from '@/assembly/singbox/tools/common'
import { appendThroughput, THROUGHPUT_HISTORY } from '@/assembly/singbox/tools/network-quality'
import { natTone } from '@/assembly/singbox/tools/stun'
import { EXPIRY_SOON_SECONDS, expiryState, pingPath } from '@/assembly/singbox/tools/tailscale'
import { deadlineIn } from '@/assembly/singbox/tools/vpn'
import type { Proxy } from '@/types'
import { describe, expect, it } from 'vitest'

const now = 1_800_000_000

describe('expiryState', () => {
  it('classifies expiry', () => {
    expect(expiryState({ keyExpiry: 0, expired: false }, now)).toBe('ok')
    expect(expiryState({ keyExpiry: 0, expired: true }, now)).toBe('expired')
    expect(expiryState({ keyExpiry: now - 1, expired: false }, now)).toBe('expired')
    expect(expiryState({ keyExpiry: now, expired: false }, now)).toBe('expired')
    expect(expiryState({ keyExpiry: now + EXPIRY_SOON_SECONDS, expired: false }, now)).toBe('soon')
    expect(expiryState({ keyExpiry: now + EXPIRY_SOON_SECONDS + 1, expired: false }, now)).toBe('ok')
  })
})

describe('pingPath', () => {
  const base = { isDirect: false, peerRelay: '', derpRegionID: 0, derpRegionCode: '' }

  it('prefers direct, then peer relay, then DERP', () => {
    expect(pingPath({ ...base, isDirect: true, peerRelay: 'x', derpRegionID: 3 })).toBe('direct')
    expect(pingPath({ ...base, peerRelay: '1.2.3.4:5', derpRegionID: 3 })).toBe('relay')
    expect(pingPath({ ...base, derpRegionID: 3 })).toBe('derp')
    expect(pingPath({ ...base, derpRegionCode: 'sfo' })).toBe('derp')
    expect(pingPath(base)).toBe('unknown')
  })
})

describe('appendThroughput', () => {
  it('appends increasing points and ignores stale ones', () => {
    let history = appendThroughput([], { elapsedMs: 100, downloadMbps: 1, uploadMbps: 0 })
    history = appendThroughput(history, { elapsedMs: 100, downloadMbps: 2, uploadMbps: 0 })
    history = appendThroughput(history, { elapsedMs: 50, downloadMbps: 3, uploadMbps: 0 })
    history = appendThroughput(history, { elapsedMs: 200, downloadMbps: 4, uploadMbps: 1 })

    expect(history).toEqual([
      { elapsedMs: 100, downloadMbps: 1, uploadMbps: 0 },
      { elapsedMs: 200, downloadMbps: 4, uploadMbps: 1 },
    ])
  })

  it('keeps at most THROUGHPUT_HISTORY points', () => {
    let history: ReturnType<typeof appendThroughput> = []
    for (let index = 1; index <= THROUGHPUT_HISTORY + 5; index++) {
      history = appendThroughput(history, { elapsedMs: index, downloadMbps: index, uploadMbps: 0 })
    }

    expect(history).toHaveLength(THROUGHPUT_HISTORY)
    expect(history[0].elapsedMs).toBe(6)
  })
})

describe('natTone', () => {
  it('maps NAT behaviours to tones', () => {
    expect(natTone('endpointIndependent')).toBe('good')
    expect(natTone('addressDependent')).toBe('fair')
    expect(natTone('addressAndPortDependent')).toBe('poor')
    expect(natTone('unknown')).toBe('unknown')
  })
})

describe('deadlineIn', () => {
  it('returns remaining seconds', () => {
    expect(deadlineIn({ deadline: 0 }, now)).toBeUndefined()
    expect(deadlineIn({ deadline: now + 30 }, now)).toBe(30)
    expect(deadlineIn({ deadline: now - 5 }, now)).toBe(0)
  })
})

describe('outboundOptions', () => {
  it('lists outbounds with type and latest delay', () => {
    const proxy = (name: string, type: string, delays: number[]) =>
      ({
        name,
        type,
        history: delays.map((delay, index) => ({ time: String(index), delay })),
        extra: {},
        udp: false,
        xudp: false,
        now: '',
      }) as unknown as Proxy

    proxyMap.value = {
      GLOBAL: proxy('GLOBAL', 'Selector', []),
      b: proxy('b', 'VLESS', [120, 80]),
      a: proxy('a', 'Direct', [0]),
    }

    expect(outboundOptions.value).toEqual([
      { tag: 'a', type: 'Direct', delay: undefined },
      { tag: 'b', type: 'VLESS', delay: 80 },
    ])
  })
})
```

在 `fork-test/singbox/api/tailscale.test.ts` 第一个用例里补断言（在已有 `expect(endpoint.tag).toBe('ts')` 之后）：

```ts
    expect(endpoint.keyAuth).toBe(false)
    expect(endpoint.users[0].peers[0].shareeNode).toBe(false)
```

并在该文件的 `endpoints: [{ endpointTag: 'ts', … }]` 第一个端点里加入 `keyAuth: false`（保持断言与数据一致）。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm -C fork-test exec vitest run singbox/api/tools-redesign.test.ts singbox/api/tailscale.test.ts`
Expected: FAIL（新函数未导出、`keyAuth` 为 undefined）。

- [ ] **Step 3: 实现**

`tailscale.ts`：
- `TailscalePeerView` 加 `shareeNode: boolean`，`toPeer` 加 `shareeNode: peer.shareeNode`。
- `TailscaleEndpointView` 加 `keyAuth: boolean`，`toTailscaleEndpoints` 加 `keyAuth: endpoint.keyAuth`。
- `TailscalePingSample` 加 `peerRelay: string`、`derpRegionID: number`，`startTailscalePing` 的 `onSample` 映射加 `peerRelay: response.peerRelay`、`derpRegionID: response.derpRegionID`。
- 追加：

```ts
export const EXPIRY_SOON_SECONDS = 30 * 24 * 3600

export type ExpiryState = 'expired' | 'soon' | 'ok'

export type PingPath = 'direct' | 'relay' | 'derp' | 'unknown'

export const expiryState = (
  peer: Pick<TailscalePeerView, 'keyExpiry' | 'expired'>,
  nowSeconds: number,
): ExpiryState => {
  if (peer.expired || (peer.keyExpiry > 0 && peer.keyExpiry <= nowSeconds)) return 'expired'
  if (peer.keyExpiry > 0 && peer.keyExpiry - nowSeconds <= EXPIRY_SOON_SECONDS) return 'soon'
  return 'ok'
}

export const pingPath = (
  sample: Pick<TailscalePingSample, 'isDirect' | 'peerRelay' | 'derpRegionID' | 'derpRegionCode'>,
): PingPath => {
  if (sample.isDirect) return 'direct'
  if (sample.peerRelay) return 'relay'
  if (sample.derpRegionID > 0 || sample.derpRegionCode) return 'derp'
  return 'unknown'
}
```

`network-quality.ts` 追加：

```ts
export type ThroughputPoint = {
  elapsedMs: number
  downloadMbps: number
  uploadMbps: number
}

export const THROUGHPUT_HISTORY = 120

export const appendThroughput = (
  history: ThroughputPoint[],
  result: Pick<NetworkQualityResult, 'elapsedMs' | 'downloadMbps' | 'uploadMbps'>,
): ThroughputPoint[] => {
  const last = history[history.length - 1]

  if (last && result.elapsedMs <= last.elapsedMs) return history

  return [
    ...history,
    {
      elapsedMs: result.elapsedMs,
      downloadMbps: result.downloadMbps,
      uploadMbps: result.uploadMbps,
    },
  ].slice(-THROUGHPUT_HISTORY)
}
```

`stun.ts` 追加：

```ts
export type NatTone = 'good' | 'fair' | 'poor' | 'unknown'

const NAT_TONES: Record<NatBehavior, NatTone> = {
  unknown: 'unknown',
  endpointIndependent: 'good',
  addressDependent: 'fair',
  addressAndPortDependent: 'poor',
}

export const natTone = (behavior: NatBehavior): NatTone => NAT_TONES[behavior]
```

`vpn.ts` 追加：

```ts
export const deadlineIn = (
  challenge: Pick<OpenVPNChallengeView, 'deadline'>,
  nowSeconds: number,
): number | undefined =>
  challenge.deadline > 0 ? Math.max(0, challenge.deadline - nowSeconds) : undefined
```

`common.ts` 追加（`outboundTags` 暂时保留，Task 6 删除）：

```ts
export type OutboundOption = {
  tag: string
  type: string
  delay: number | undefined
}

export const outboundOptions = computed<OutboundOption[]>(() =>
  Object.values(proxyMap.value)
    .filter((proxy) => proxy.name !== 'GLOBAL')
    .map((proxy) => ({
      tag: proxy.name,
      type: proxy.type,
      delay: proxy.history?.[proxy.history.length - 1]?.delay || undefined,
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag)),
)
```

（`proxyMap` 的键就是 `proxy.name`；若测试里键和 name 不一致导致失败，以键为准改用 `Object.entries` 并记录。）

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm -C fork-test exec vitest run singbox/api/tools-redesign.test.ts singbox/api/tailscale.test.ts`
Expected: PASS。

- [ ] **Step 5: 全量检查并提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test
git add src/assembly/singbox/tools fork-test/singbox/api/tools-redesign.test.ts fork-test/singbox/api/tailscale.test.ts
git commit -m "feat(singbox): add view helpers for the redesigned tools page"
```

---

### Task 2: tab 骨架、可见性与通用组件

**Files:**
- Create: `src/assembly/singbox/tools/tabs.ts`, `src/assembly/singbox/tools/availability.ts`, `src/components/singbox/tools/PingSparkline.vue`, `src/components/singbox/tools/QRCodeView.vue`, `src/components/singbox/tools/OutboundPickerDialog.vue`
- Modify: `src/views/ToolsPage.vue`, `src/i18n/singbox/*.ts`
- Test: `fork-test/singbox/api/tools-tabs.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `outboundOptions`、`OutboundOption`；现有 `tailscaleStream`、`openVPNStream`、`openConnectStream`、`toTailscaleEndpoints`、`toOpenVPNEndpoints`、`toOpenConnectEndpoints`、`fetchEbpfDiagnostics`、`toolErrorMessage`。
- Produces:
  - `tabs.ts`：`type ToolsTab = 'network' | 'tailscale' | 'openvpn' | 'openconnect' | 'ebpf'`；`type TabsInput = { tailscale: boolean; openvpn: boolean; openconnect: boolean; ebpf: boolean; tailscaleSeen: boolean; openvpnSeen: boolean; openconnectSeen: boolean; ebpfInbounds: number }`（`*Seen` 表示本次页面生命周期里出现过端点）；`visibleTabs(input: TabsInput): ToolsTab[]`；`resolveActiveTab(stored: string, visible: ToolsTab[]): ToolsTab`
  - `availability.ts`：`useToolsAvailability()` 返回 `{ tailscale: ShallowRef<TailscaleEndpointView[]>; tailscaleError: ComputedRef<string>; openvpn: ShallowRef<OpenVPNEndpointView[]>; openvpnError: ComputedRef<string>; openconnect: ShallowRef<OpenConnectEndpointView[]>; openconnectError: ComputedRef<string>; ebpf: ShallowRef<EbpfDiagnostics | undefined>; ebpfError: Ref<string>; ebpfLoading: Ref<boolean>; refreshEbpf: () => Promise<void>; tabs: ComputedRef<ToolsTab[]> }`
  - `PingSparkline.vue` props `{ data: number[]; height?: number; color?: string; capacity?: number }`（与上游一致）
  - `QRCodeView.vue` props `{ value: string }`（与上游一致）
  - `OutboundPickerDialog.vue`：`v-model:open`（boolean）+ `v-model`（string，'' 表示默认路由）；props `{ title: string }`；内部读 `outboundOptions`
  - 后续任务往 `ToolsPage.vue` 里替换各 tab 的内容组件。

- [ ] **Step 1: 写失败的测试**

`fork-test/singbox/api/tools-tabs.test.ts`：

```ts
import { resolveActiveTab, visibleTabs, type TabsInput } from '@/assembly/singbox/tools/tabs'
import { describe, expect, it } from 'vitest'

const none: TabsInput = {
  tailscale: false,
  openvpn: false,
  openconnect: false,
  ebpf: false,
  tailscaleSeen: false,
  openvpnSeen: false,
  openconnectSeen: false,
  ebpfInbounds: 0,
}

describe('visibleTabs', () => {
  it('always shows network', () => {
    expect(visibleTabs(none)).toEqual(['network'])
  })

  it('needs both the capability and an endpoint', () => {
    expect(visibleTabs({ ...none, tailscale: true })).toEqual(['network'])
    expect(visibleTabs({ ...none, tailscaleSeen: true })).toEqual(['network'])
    expect(visibleTabs({ ...none, tailscale: true, tailscaleSeen: true })).toEqual([
      'network',
      'tailscale',
    ])
  })

  it('orders all tabs', () => {
    expect(
      visibleTabs({
        tailscale: true,
        openvpn: true,
        openconnect: true,
        ebpf: true,
        tailscaleSeen: true,
        openvpnSeen: true,
        openconnectSeen: true,
        ebpfInbounds: 1,
      }),
    ).toEqual(['network', 'tailscale', 'openvpn', 'openconnect', 'ebpf'])
  })

  it('hides eBPF without inbounds', () => {
    expect(visibleTabs({ ...none, ebpf: true })).toEqual(['network'])
  })
})

describe('resolveActiveTab', () => {
  it('keeps a visible tab and falls back to network', () => {
    expect(resolveActiveTab('tailscale', ['network', 'tailscale'])).toBe('tailscale')
    expect(resolveActiveTab('tailscale', ['network'])).toBe('network')
    expect(resolveActiveTab('garbage', ['network'])).toBe('network')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm -C fork-test exec vitest run singbox/api/tools-tabs.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 tabs.ts**

```ts
export type ToolsTab = 'network' | 'tailscale' | 'openvpn' | 'openconnect' | 'ebpf'

export type TabsInput = {
  tailscale: boolean
  openvpn: boolean
  openconnect: boolean
  ebpf: boolean
  tailscaleSeen: boolean
  openvpnSeen: boolean
  openconnectSeen: boolean
  ebpfInbounds: number
}

export const visibleTabs = (input: TabsInput): ToolsTab[] => {
  const tabs: ToolsTab[] = ['network']

  if (input.tailscale && input.tailscaleSeen) tabs.push('tailscale')
  if (input.openvpn && input.openvpnSeen) tabs.push('openvpn')
  if (input.openconnect && input.openconnectSeen) tabs.push('openconnect')
  if (input.ebpf && input.ebpfInbounds > 0) tabs.push('ebpf')

  return tabs
}

export const resolveActiveTab = (stored: string, visible: ToolsTab[]): ToolsTab =>
  visible.includes(stored as ToolsTab) ? (stored as ToolsTab) : 'network'
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm -C fork-test exec vitest run singbox/api/tools-tabs.test.ts`
Expected: PASS。

- [ ] **Step 5: 实现 availability.ts**

```ts
import { can } from '@/assembly/backend'
import { activeUuid } from '@/store/setup'
import { computed, ref, shallowRef, watch, watchEffect } from 'vue'
import type { SharedStream } from '../api/stream'
import { toolErrorMessage } from './common'
import { fetchEbpfDiagnostics, type EbpfDiagnostics } from './ebpf'
import { visibleTabs } from './tabs'
import { tailscaleStream, toTailscaleEndpoints, type TailscaleEndpointView } from './tailscale'
import {
  openConnectStream,
  openVPNStream,
  toOpenConnectEndpoints,
  toOpenVPNEndpoints,
  type OpenConnectEndpointView,
  type OpenVPNEndpointView,
} from './vpn'

const follow = <M, V>(
  enabled: () => boolean,
  stream: SharedStream<M>,
  map: (message: M) => V[],
) => {
  const data = shallowRef<V[]>([])
  const seen = ref(false)

  watchEffect((onCleanup) => {
    data.value = []
    seen.value = false
    if (!enabled()) return

    const off = stream.subscribe((message) => {
      data.value = map(message)
      if (data.value.length > 0) seen.value = true
    })

    onCleanup(off)
  })

  const error = computed(() =>
    stream.phase.value !== 'active' && stream.error.value
      ? toolErrorMessage(stream.error.value)
      : '',
  )

  return { data, seen, error }
}

export const useToolsAvailability = () => {
  const tailscale = follow(() => can('tailscale'), tailscaleStream, toTailscaleEndpoints)
  const openvpn = follow(
    () => can('openvpn'),
    openVPNStream,
    (message: Parameters<typeof toOpenVPNEndpoints>[0]) => toOpenVPNEndpoints(message),
  )
  const openconnect = follow(
    () => can('openconnect'),
    openConnectStream,
    (message: Parameters<typeof toOpenConnectEndpoints>[0]) => toOpenConnectEndpoints(message),
  )

  const ebpf = shallowRef<EbpfDiagnostics>()
  const ebpfError = ref('')
  const ebpfLoading = ref(false)

  const refreshEbpf = async () => {
    if (!can('ebpfDiagnostics')) {
      ebpf.value = undefined
      return
    }

    ebpfLoading.value = true
    ebpfError.value = ''
    try {
      ebpf.value = await fetchEbpfDiagnostics()
    } catch (e) {
      ebpfError.value = toolErrorMessage(e)
    } finally {
      ebpfLoading.value = false
    }
  }

  watch([activeUuid, () => can('ebpfDiagnostics')], refreshEbpf, { immediate: true })

  const tabs = computed(() =>
    visibleTabs({
      tailscale: can('tailscale'),
      openvpn: can('openvpn'),
      openconnect: can('openconnect'),
      ebpf: can('ebpfDiagnostics'),
      tailscaleSeen: tailscale.seen.value,
      openvpnSeen: openvpn.seen.value,
      openconnectSeen: openconnect.seen.value,
      ebpfInbounds: ebpf.value?.inbounds.length ?? 0,
    }),
  )

  return {
    tailscale: tailscale.data,
    tailscaleError: tailscale.error,
    openvpn: openvpn.data,
    openvpnError: openvpn.error,
    openconnect: openconnect.data,
    openconnectError: openconnect.error,
    ebpf,
    ebpfError,
    ebpfLoading,
    refreshEbpf,
    tabs,
  }
}
```

说明：`watchEffect` 在组件 setup 里调用，卸载时自动停止并执行 `onCleanup` 释放订阅；切换后端时 `can()` 变化会重新订阅。若 `follow` 的泛型推断导致类型报错，直接写三段显式代码，行为不变，并在报告里说明。

- [ ] **Step 6: 移植 PingSparkline 与 QRCodeView**

```bash
git show '4adb4872^:src/components/tools/PingSparkline.vue' > src/components/singbox/tools/PingSparkline.vue
git show '4adb4872^:src/components/tools/QRCodeView.vue' > src/components/singbox/tools/QRCodeView.vue
```

删掉两个文件里的全部注释，其余不改。

- [ ] **Step 7: OutboundPickerDialog.vue**

```vue
<template>
  <DialogWrapper
    v-model="open"
    :title="title"
  >
    <div class="flex flex-col gap-2">
      <input
        v-model="query"
        class="input input-sm w-full"
        :placeholder="$t('toolSearchOutbound')"
      />
      <div class="max-h-96 overflow-y-auto">
        <button
          class="hover:bg-base-200 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm"
          @click="choose('')"
        >
          <span class="flex-1">{{ $t('toolDefaultRoute') }}</span>
          <CheckIcon
            v-if="model === ''"
            class="text-primary size-4"
          />
        </button>
        <button
          v-for="option in filtered"
          :key="option.tag"
          class="hover:bg-base-200 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm"
          @click="choose(option.tag)"
        >
          <span class="min-w-0 flex-1 truncate">{{ option.tag }}</span>
          <span class="text-base-content/50 text-xs">{{ option.type }}</span>
          <span
            v-if="option.delay"
            class="text-base-content/60 w-14 text-right font-mono text-xs tabular-nums"
            >{{ option.delay }} ms</span
          >
          <CheckIcon
            v-if="model === option.tag"
            class="text-primary size-4"
          />
        </button>
      </div>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import { outboundOptions } from '@/assembly/singbox/tools/common'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { CheckIcon } from '@heroicons/vue/24/outline'
import { computed, ref, watch } from 'vue'

defineProps<{
  title: string
}>()

const open = defineModel<boolean>('open', { required: true })
const model = defineModel<string>({ required: true })
const query = ref('')

const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase()

  return keyword
    ? outboundOptions.value.filter((option) => option.tag.toLowerCase().includes(keyword))
    : outboundOptions.value
})

const choose = (tag: string) => {
  model.value = tag
  open.value = false
}

watch(open, (value) => {
  if (value) query.value = ''
})
</script>
```

- [ ] **Step 8: ToolsPage 骨架**

`src/views/ToolsPage.vue` 改为下面的结构；本任务里各 tab 暂时挂旧组件，后续任务逐个替换：

```vue
<template>
  <div class="relative flex h-full min-h-0 flex-col">
    <CtrlsBar>
      <div class="flex items-center gap-2 p-2">
        <SegmentedControl
          v-model="activeTab"
          :options="tabOptions"
        />
      </div>
    </CtrlsBar>

    <div
      class="min-h-0 flex-1 overflow-y-auto"
      :style="padding"
    >
      <div class="mx-auto flex max-w-5xl flex-col gap-3 p-3">
        <template v-if="currentTab === 'network'">
          <NetworkQualityCard />
          <StunCard />
        </template>
        <TailscaleCard v-else-if="currentTab === 'tailscale'" />
        <OpenVPNCard v-else-if="currentTab === 'openvpn'" />
        <OpenConnectCard v-else-if="currentTab === 'openconnect'" />
        <EbpfCard v-else-if="currentTab === 'ebpf'" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useToolsAvailability } from '@/assembly/singbox/tools/availability'
import { resolveActiveTab, type ToolsTab } from '@/assembly/singbox/tools/tabs'
import CtrlsBar from '@/components/common/CtrlsBar.vue'
import SegmentedControl, { type SegmentOption } from '@/components/common/SegmentedControl.vue'
import EbpfCard from '@/components/singbox/tools/EbpfCard.vue'
import NetworkQualityCard from '@/components/singbox/tools/NetworkQualityCard.vue'
import OpenConnectCard from '@/components/singbox/tools/OpenConnectCard.vue'
import OpenVPNCard from '@/components/singbox/tools/OpenVPNCard.vue'
import StunCard from '@/components/singbox/tools/StunCard.vue'
import TailscaleCard from '@/components/singbox/tools/TailscaleCard.vue'
import { usePaddingForViews } from '@/composables/use-padding-for-views'
import { useStorage } from '@/composables/use-storage'
import {
  CpuChipIcon,
  LinkIcon,
  ShareIcon,
  ShieldCheckIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/vue/24/outline'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const availability = useToolsAvailability()
const storedTab = useStorage<string>('config/singbox-tools-tab', 'network')

const currentTab = computed<ToolsTab>(() =>
  resolveActiveTab(storedTab.value, availability.tabs.value),
)

const activeTab = computed({
  get: () => currentTab.value,
  set: (value: string) => {
    storedTab.value = value
  },
})

const TAB_META: Record<ToolsTab, { label: string; icon: SegmentOption['icon'] }> = {
  network: { label: 'toolsNetwork', icon: WrenchScrewdriverIcon },
  tailscale: { label: 'tailscale', icon: ShareIcon },
  openvpn: { label: 'openvpn', icon: ShieldCheckIcon },
  openconnect: { label: 'openconnect', icon: LinkIcon },
  ebpf: { label: 'ebpfDiagnostics', icon: CpuChipIcon },
}

const tabOptions = computed<SegmentOption[]>(() =>
  availability.tabs.value.map((tab) => ({
    value: tab,
    label: t(TAB_META[tab].label),
    icon: TAB_META[tab].icon,
  })),
)

const { padding } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 8,
})
</script>
```

说明：
- 本任务里旧卡片还会自己订阅流，与 `useToolsAvailability` 的订阅共用同一条共享流，不会多开连接；Task 4–6 会把数据改为从 `availability` 以 props 传入。
- 确认 `useStorage` 的导入路径：仓库里是 `src/composables/use-storage.ts`（见 CLAUDE.md）。
- 确认 `SegmentOption['icon']` 类型可用；不可用时改为 `Component`。

- [ ] **Step 9: 文案**

四个 fork i18n 文件各追加：

| key | en | zh | zh-tw | ru |
|---|---|---|---|---|
| `toolsNetwork` | `Network` | `网络` | `網路` | `Сеть` |
| `toolSearchOutbound` | `Search outbounds` | `搜索出站` | `搜尋出站` | `Поиск исходящих` |

- [ ] **Step 10: 全量检查并提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test && pnpm build
rg -l "grpc-websockets|application/grpc-web" dist/assets/index-*.js || echo "main chunk clean"
git add src/assembly/singbox/tools src/components/singbox/tools src/views/ToolsPage.vue src/i18n/singbox fork-test/singbox/api/tools-tabs.test.ts
git commit -m "feat(singbox): switch tools page to tabs with availability-driven visibility"
```

---

### Task 3: 网络 tab

**Files:**
- Create: `src/components/singbox/tools/NetworkToolsPanel.vue`（移植自 `4adb4872^:src/components/tools/NetworkToolsPanel.vue`）
- Modify: `src/views/ToolsPage.vue`（network 分支改为 `<NetworkToolsPanel />`），`src/i18n/singbox/*.ts`

**Interfaces:**
- Consumes: `startNetworkQualityTest`、`NETWORK_QUALITY_DEFAULTS`、`NetworkQualityResult`、`Accuracy`、`appendThroughput`、`ThroughputPoint`（network-quality.ts）；`startStunTest`、`STUN_DEFAULT_SERVER`、`StunResult`、`NatBehavior`、`natTone`（stun.ts）；`toolErrorMessage`、`StreamingRun`（common.ts）；`OutboundPickerDialog.vue`；`TimeSeriesChart.vue` 与 `src/components/charts/chart-types.ts`、`chart-tooltip.ts`；`activeUuid`（`@/store/setup`）。

- [ ] **Step 1: 取出上游源码**

```bash
git show '4adb4872^:src/components/tools/NetworkToolsPanel.vue' > src/components/singbox/tools/NetworkToolsPanel.vue
```

- [ ] **Step 2: 按下表改写**

| 上游写法 | 改为 |
|---|---|
| `import { getSingboxClient } from '@/assembly/tools'` 与所有 `getSingboxClient().client.startNetworkQualityTest / startSTUNTest` 的调用 | `startNetworkQualityTest(options, onProgress)` / `startStunTest(options, onProgress)`，返回 `StreamingRun`，用 `run.cancel()` 取消，`run.done.catch(e => error = toolErrorMessage(e))` |
| 类型 `NetworkQualityTestProgress` / `STUNTestProgress`（gen） | `NetworkQualityResult` / `StunResult` |
| 进度里的 bigint 与 `Number(...)` 换算、手写的 bits→Mbps 换算 | 直接用 `result.downloadMbps` / `uploadMbps` / `elapsedMs` 等 number 字段 |
| 精度枚举数字 | `result.accuracy.*`（`'low' \| 'medium' \| 'high'`），色标：high → `badge-success`，medium → `badge-warning`，low → `badge-ghost` |
| NAT 枚举数字与着色 | `result.natMapping` / `natFiltering`（`NatBehavior`），颜色用 `natTone`：good → `text-success`，fair → `text-warning`，poor → `text-error`，unknown → `text-base-content/60`；文案沿用现有键 `natUnknown` / `natEndpointIndependent` / `natAddressDependent` / `natAddressAndPortDependent` |
| 吞吐曲线的数据累积 | 用 `appendThroughput(history, result)` 维护 `ThroughputPoint[]`，映射成 `TimeSeriesChart` 需要的 `ChartSeries[]`（下行、上行两条） |
| `import { chartTooltipRow } from '@/components/charts/chartTooltip'`、`'@/components/charts/chartTypes'` | 改为 `'@/components/charts/chart-tooltip'`、`'@/components/charts/chart-types'`（当前文件名），导出名以当前文件为准 |
| 出站选择（上游 `SelectInput` + `proxyMap`） | 一行“出站节点”，值显示当前 tag 或“默认路由”，点击打开 `OutboundPickerDialog` |
| 最长运行时间 | 保留上游的选项（默认 / 10 / 20 / 30 / 60 秒；“默认”对应 `maxRuntimeSeconds: 0`） |
| 开始 / 取消 | 运行中禁用所有输入，按钮显示 `loading loading-spinner` 和“取消” |
| 结果区 | 只在开始过测试后渲染（`result` 有值） |
| STUN 外部地址 | 行尾加复制按钮（`useClipboard` from `@vueuse/core`） |
| `natTypeSupported === false` | 显示一行 `stunNatUnsupported` |
| 切换后端 | `watch(activeUuid, () => run.value?.cancel())`，两个测试各一 |
| `onBeforeUnmount` | 取消正在进行的测试 |
| 注释 | 全部删除 |
| 上游 i18n 键 | 已在 fork i18n 中存在的直接复用（如 `networkQuality`、`networkQualityDownload`、`stunExternalAddress`、`accuracyHigh` 等）；不存在的，从 `git show '4adb4872^:src/i18n/<lang>.ts'` 取同名键的四份翻译，加到 `src/i18n/singbox/*.ts` |

布局：外层 `grid gap-4 lg:grid-cols-2`，左侧网络质量、右侧 STUN；每侧由一个小标题（`settings-section-label`）和 `settings-grid` 行列表组成，结果卡片放在配置行下方。

- [ ] **Step 3: 接入页面**

`ToolsPage.vue` 的 network 分支换成 `<NetworkToolsPanel />`，删除 `NetworkQualityCard`、`StunCard` 的导入（文件本身在 Task 6 删除）。

- [ ] **Step 4: 检查与提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test && pnpm build
rg -l "grpc-websockets|application/grpc-web" dist/assets/index-*.js || echo "main chunk clean"
git add src/components/singbox/tools/NetworkToolsPanel.vue src/views/ToolsPage.vue src/i18n/singbox
git commit -m "feat(singbox): port network tools tab with throughput chart and tone labels"
```

---

### Task 4: Tailscale tab

**Files:**
- Create: `src/components/singbox/tools/TailscalePanel.vue`、`TailscalePeerDialog.vue`、`TailscaleExitNodeDialog.vue`（分别移植自 `4adb4872^:src/components/tools/` 下同名文件）
- Modify: `src/views/ToolsPage.vue`，`src/i18n/singbox/*.ts`

**Interfaces:**
- Consumes: `availability.tailscale`、`availability.tailscaleError`（Task 2）；`TailscaleEndpointView`、`TailscalePeerView`、`TailscalePingSample`、`setTailscaleExitNode`、`logoutTailscale`、`startTailscalePing`、`PING_HISTORY`、`expiryState`、`pingPath`（tailscale.ts）；`toolErrorMessage`、`StreamingRun`；`PingSparkline.vue`、`QRCodeView.vue`、`DialogWrapper.vue`；`notifyRequestError`（`@/helper/request-error`）；`fromNow`、`prettyBytesHelper`（`@/helper/utils`）。
- Produces: `TailscalePanel` props `{ endpoints: TailscaleEndpointView[]; error: string }`。

- [ ] **Step 1: 取出上游源码**

```bash
for f in TailscalePanel TailscalePeerDialog TailscaleExitNodeDialog; do
  git show "4adb4872^:src/components/tools/${f}.vue" > "src/components/singbox/tools/${f}.vue"
done
```

- [ ] **Step 2: 按下表改写**

| 上游写法 | 改为 |
|---|---|
| props `endpoints: TailscaleEndpointStatus[]`（gen） | `endpoints: TailscaleEndpointView[]`，另加 `error: string`，非空时在段顶显示 `text-error` 一行 |
| 字段 `endpointTag` / `backendState` / `stateText` / `authURL` / `networkName` / `magicDNSSuffix` / `self` / `exitNode` / `userGroups[].displayName,loginName,peers` | 视图字段 `tag` / `backendState` / `stateText` / `authURL`（已是安全 URL）/ `networkName` / `magicDNSSuffix` / `self` / `exitNode` / `users[].name,peers` |
| peer 字段 `tailscaleIPs` / `stableID` / `hostName` / `dnsName` / `os` / `online` / `exitNode` / `exitNodeOption` / `rxBytes` / `txBytes` / `keyExpiry` / `expired` / `lastSeen` / `shareeNode`（bigint 字段用 `Number`） | 视图字段 `ips` / `stableID` / `hostName` / `dnsName` / `os` / `online` / `exitNode` / `exitNodeOption` / `rxBytes` / `txBytes` / `keyExpiry` / `expired` / `lastSeen` / `shareeNode`（已是 number） |
| 上游对过期的判断 | `expiryState(peer, Date.now() / 1000)`：`expired` 显示红色 `badge-error`“已过期”，`soon` 显示黄色 `badge-warning`“即将过期” |
| `getSingboxClient().client.setTailscaleExitNode` | `setTailscaleExitNode(tag, stableID)`；失败时 `notifyRequestError(new Error(toolErrorMessage(e)))`，对话框保持打开，选中项回到 `endpoint.exitNode?.stableID ?? ''` |
| `getSingboxClient().client.tailscaleLogout` | `logoutTailscale(tag)`；登出按钮只在 `!endpoint.keyAuth` 时显示，点击后用 `DialogWrapper` 做确认对话框 |
| Ping 的流 | `startTailscalePing(tag, ip, onSample)` 返回 `StreamingRun`；样本保留最近 `PING_HISTORY` 个；连接方式按 `pingPath(sample)` 显示：`direct` →“直连 + endpoint”，`relay` →“peer relay + peerRelay”，`derp` →“DERP + derpRegionCode”，`unknown` → 不显示；对话框关闭或卸载时 `cancel()` |
| 登录：`authURL` 非空 | 显示一行“需要登录”，点击打开对话框，内含 `QRCodeView` 和链接（`rel="noopener noreferrer"`） |
| 出口节点那一行 | 只在 `endpoint.exitNodeOptions.length > 0` 时显示；候选来自 `exitNodeOptions` |
| Taildrop、SSH（`TaildropDialog`、`TailscaleSSHDialog`、`tailscaleSSH`、`taildropSend`、行尾的发送和终端图标、`@ssh` emit） | 全部删除 |
| `peerDisplayName`（来自 `@/composables/tailscaleSSH`） | 在 `TailscalePanel.vue` 内定义：`(peer) => peer.hostName \|\| peer.dnsName.split('.')[0] \|\| peer.ips[0] \|\| ''`，并在两个对话框里用 props 传入或本地同样定义 |
| `sshPrefs` 等 SSH 相关状态 | 删除 |
| 状态标签颜色 | `Running` → `badge-success`，`NeedsLogin` / `NeedsMachineAuth` → `badge-warning`，其余 → `badge-ghost`；`stateText` 与 `backendState` 相同时只显示一次 |
| 注释 | 全部删除 |
| 上游 i18n 键 | 同 Task 3 的规则 |

- [ ] **Step 3: 接入页面**

`ToolsPage.vue` 的 tailscale 分支改为：

```vue
        <TailscalePanel
          v-else-if="currentTab === 'tailscale'"
          :endpoints="availability.tailscale.value"
          :error="availability.tailscaleError.value"
        />
```

删除 `TailscaleCard` 的导入。

- [ ] **Step 4: 检查与提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test && pnpm build
rg -l "grpc-websockets|application/grpc-web" dist/assets/index-*.js || echo "main chunk clean"
git add src/components/singbox/tools src/views/ToolsPage.vue src/i18n/singbox
git commit -m "feat(singbox): port Tailscale tab with peer and exit node dialogs"
```

---

### Task 5: OpenVPN 与 OpenConnect tab

**Files:**
- Create: `src/components/singbox/tools/OpenVPNPanel.vue`、`OpenVPNAuthForm.vue`（移植自 `4adb4872^:src/components/tools/` 同名文件）；`OpenConnectPanel.vue`、`OpenConnectAuthForm.vue`（新写，结构与 OpenVPN 两个文件相同）；`VpnTunnelRows.vue`（新写，两者共用）
- Modify: `src/views/ToolsPage.vue`，`src/i18n/singbox/*.ts`

**Interfaces:**
- Consumes: `availability.openvpn/openvpnError/openconnect/openconnectError`；`OpenVPNEndpointView`、`OpenVPNChallengeView`、`OpenConnectEndpointView`、`OpenConnectChallengeView`、`OpenConnectField`、`VpnTunnelView`、`initialFormValues`、`submitOpenVPNChallenge`、`cancelOpenVPNChallenge`、`submitOpenConnectForm`、`cancelOpenConnectChallenge`、`deadlineIn`（vpn.ts）；`QRCodeView.vue`、`DialogWrapper.vue`；`fromNow`（`@/helper/utils`）；`useNow`（`@vueuse/core`）。
- Produces: `OpenVPNPanel` / `OpenConnectPanel` props `{ endpoints: …EndpointView[]; error: string }`；`VpnTunnelRows` props `{ tunnel: VpnTunnelView }`。

- [ ] **Step 1: 取出上游源码**

```bash
for f in OpenVPNPanel OpenVPNAuthForm; do
  git show "4adb4872^:src/components/tools/${f}.vue" > "src/components/singbox/tools/${f}.vue"
done
```

- [ ] **Step 2: 改写 OpenVPN**

| 上游写法 | 改为 |
|---|---|
| props `endpoints: OpenVPNEndpointStatus[]`（gen） | `endpoints: OpenVPNEndpointView[]`，加 `error: string` |
| 字段 `endpointTag` / `state` / `stateText` / `error` / `tunnelInfo` / `challenge` | `tag` / `state` / `stateText` / `error` / `tunnel` / `challenge` |
| 隧道信息行 | 抽成 `VpnTunnelRows.vue`：服务器、地址（`tunnel.addresses.join(', ')`）、DNS、MTU、连接时长（`fromNow(tunnel.connectedSince * 1000)`）、以及 `tunnel.extra`（`label` 是 i18n 键）；值为空的行不渲染 |
| `OpenVPNAuthForm` 的 props `challenge: OpenVPNChallenge`（gen） | `challenge: OpenVPNChallengeView`、`endpointTag: string` |
| 提交 / 取消 `getSingboxClient().client.submitOpenVPNChallengeResponse / cancelOpenVPNChallenge` | `submitOpenVPNChallenge(tag, id, response)` / `cancelOpenVPNChallenge(tag, id)`；失败用 `showNotification` 或 `notifyRequestError(new Error(toolErrorMessage(e)))` |
| 挑战类型处理 | `credentials`：用户名、密码、验证码三项都显示（与 sing-box CLI 一致）；`secret`：只显示验证码，`echo` 为 false 时 `type="password"`；`message`：只显示文本和取消；`open-url`：显示链接和二维码按钮（`QRCodeView` 放在对话框里）；`unknown`：显示文本和取消 |
| 截止时间 | `deadlineIn(challenge, now.value.getTime() / 1000)`，有值时显示“剩余 N 秒” |
| 表单状态 | 每个 `OpenVPNAuthForm` 实例自己持有状态，并以 `:key="endpoint.tag + challenge.id"` 渲染，天然按端点和挑战隔离 |
| 注释 | 全部删除 |

- [ ] **Step 3: 新写 OpenConnect**

`OpenConnectPanel.vue`：结构与改写后的 `OpenVPNPanel.vue` 相同（段头 tag + 状态标签、`VpnTunnelRows`、有挑战时在段顶渲染 `OpenConnectAuthForm`），数据来自 `OpenConnectEndpointView`。

`OpenConnectAuthForm.vue`：props `{ endpointTag: string; challenge: OpenConnectChallengeView }`，以 `:key="endpoint.tag + challenge.id"` 渲染：
- 显示 `banner`、`message`、`error`（红色）。
- `type === 'form'`：`values = ref(initialFormValues(challenge.fields))`；`select` 渲染成 `<select>`，`text` / `password` 渲染成对应 `type` 的 `<input>`，`hidden` 不渲染；提交调用 `submitOpenConnectForm(endpointTag, challenge.id, { ...values.value })`。
- `type === 'browser'`：显示链接（`rel="noopener noreferrer"`）和 `vpnBrowserUnsupported` 提示。
- 取消按钮调用 `cancelOpenConnectChallenge(endpointTag, challenge.id)`。
- 失败用 `notifyRequestError(new Error(toolErrorMessage(e)))`。

- [ ] **Step 4: 接入页面**

```vue
        <OpenVPNPanel
          v-else-if="currentTab === 'openvpn'"
          :endpoints="availability.openvpn.value"
          :error="availability.openvpnError.value"
        />
        <OpenConnectPanel
          v-else-if="currentTab === 'openconnect'"
          :endpoints="availability.openconnect.value"
          :error="availability.openconnectError.value"
        />
```

删除 `OpenVPNCard`、`OpenConnectCard` 的导入。

- [ ] **Step 5: 文案**

复用现有 `vpn*` 键；新增：

| key | en | zh | zh-tw | ru |
|---|---|---|---|---|
| `vpnDeadline` | `{seconds}s left` | `剩余 {seconds} 秒` | `剩餘 {seconds} 秒` | `Осталось {seconds} с` |
| `vpnShowQRCode` | `Show QR code` | `显示二维码` | `顯示 QR 碼` | `Показать QR-код` |

上游组件里用到的其他键按 Task 3 的规则处理。

- [ ] **Step 6: 检查与提交**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test && pnpm build
rg -l "grpc-websockets|application/grpc-web" dist/assets/index-*.js || echo "main chunk clean"
git add src/components/singbox/tools src/views/ToolsPage.vue src/i18n/singbox
git commit -m "feat(singbox): port OpenVPN tab and add OpenConnect tab in row layout"
```

---

### Task 6: eBPF tab、清理旧组件与浏览器验证

**Files:**
- Create: `src/components/singbox/tools/EbpfPanel.vue`
- Delete: `src/components/singbox/tools/{ToolSection,StatCell,OutboundSelect,NetworkQualityCard,StunCard,TailscaleCard,TailscaleEndpoint,TailscalePeer,OpenVPNCard,OpenConnectCard,VpnTunnel,EbpfCard}.vue`
- Modify: `src/views/ToolsPage.vue`，`src/assembly/singbox/tools/common.ts`（删掉不再使用的 `outboundTags`、`useSharedStream`，确认无引用后再删），`src/i18n/singbox/*.ts`（删掉不再使用的键，例如 `toolNotConfigured`；每个键删之前用 `rg` 确认无引用）

**Interfaces:**
- Consumes: `availability.ebpf/ebpfError/ebpfLoading/refreshEbpf`；`EbpfDiagnostics`、`EbpfInboundSummary`（ebpf.ts）；`vue-json-pretty`。
- Produces: `EbpfPanel` props `{ diagnostics: EbpfDiagnostics | undefined; error: string; loading: boolean }`，emit `refresh`。

- [ ] **Step 1: EbpfPanel.vue**

```vue
<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-end gap-2">
      <span
        v-if="error"
        class="text-error flex-1 text-sm"
        >{{ error }}</span
      >
      <button
        class="btn btn-sm"
        :disabled="loading"
        @click="emit('refresh')"
      >
        <span
          v-if="loading"
          class="loading loading-spinner loading-xs"
        ></span>
        {{ $t('ebpfRefresh') }}
      </button>
    </div>

    <section
      v-for="inbound in diagnostics?.inbounds ?? []"
      :key="inbound.tag"
      class="flex flex-col gap-1"
    >
      <div class="settings-section-label">{{ inbound.tag }}</div>
      <div class="settings-grid text-sm">
        <div class="flex items-center justify-between gap-3 px-4 py-3">
          <span>{{ $t('ebpfState') }}</span>
          <span :class="stateClass(inbound.state)">{{ inbound.state || '-' }}</span>
        </div>
        <div class="flex items-center justify-between gap-3 px-4 py-3">
          <span>{{ $t('ebpfDataPlane') }}</span>
          <span class="font-mono">{{ inbound.dataPlane || '-' }}</span>
        </div>
        <div class="flex items-center justify-between gap-3 px-4 py-3">
          <span>{{ $t('ebpfUdpSessions') }}</span>
          <span class="font-mono tabular-nums">{{ inbound.udpSessions }}</span>
        </div>
        <div
          v-if="inbound.lastError"
          class="flex items-start justify-between gap-3 px-4 py-3"
        >
          <span>{{ $t('ebpfLastError') }}</span>
          <span class="text-error text-right break-all">{{ inbound.lastError }}</span>
        </div>
        <details class="collapse-arrow collapse rounded-none">
          <summary class="collapse-title text-sm">{{ $t('ebpfRawData') }}</summary>
          <div class="collapse-content overflow-x-auto">
            <VueJsonPretty :data="inbound.detail" />
          </div>
        </details>
      </div>
    </section>

    <section
      v-if="diagnostics?.kernelRuntime"
      class="flex flex-col gap-1"
    >
      <div class="settings-section-label">{{ $t('ebpfKernelRuntime') }}</div>
      <div class="settings-grid text-sm">
        <details class="collapse-arrow collapse rounded-none">
          <summary class="collapse-title text-sm">{{ $t('ebpfRawData') }}</summary>
          <div class="collapse-content overflow-x-auto">
            <VueJsonPretty :data="diagnostics.kernelRuntime" />
          </div>
        </details>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { EbpfDiagnostics } from '@/assembly/singbox/tools/ebpf'
import VueJsonPretty from 'vue-json-pretty'
import 'vue-json-pretty/lib/styles.css'

defineProps<{
  diagnostics: EbpfDiagnostics | undefined
  error: string
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'refresh'): void
}>()

const stateClass = (state: string) => {
  const value = state.toLowerCase()

  if (['running', 'active', 'attached', 'ready'].includes(value)) return 'text-success'
  if (['failed', 'error', 'unrecoverable'].includes(value)) return 'text-error'
  return 'text-warning'
}
</script>
```

先用 `rg -n "State|state" /Users/moon/Workspace.localized/go/mod/sing-box/protocol/ebpf* /Users/moon/Workspace.localized/go/mod/sing-box/daemon/started_service_ebpf.go` 查出 sing-box 实际的状态取值，按实际值调整 `stateClass` 的列表，并在报告里写明依据。检查 `settings-grid` 的子元素样式与设置页一致（参照 `src/components/settings/backend/BackendSettings.vue` 的用法），不一致时照设置页调整类名。

- [ ] **Step 2: 接入页面并删除旧组件**

`ToolsPage.vue` 的 ebpf 分支改为：

```vue
        <EbpfPanel
          v-else-if="currentTab === 'ebpf'"
          :diagnostics="availability.ebpf.value"
          :error="availability.ebpfError.value"
          :loading="availability.ebpfLoading.value"
          @refresh="availability.refreshEbpf"
        />
```

删除 `EbpfCard` 的导入；删除上面 Files 里列出的 12 个旧组件；用 `rg` 确认 `outboundTags`、`useSharedStream`、以及各旧 i18n 键没有剩余引用后删除它们（`fork-test` 里若有引用，一并更新测试）。

- [ ] **Step 3: 文案**

| key | en | zh | zh-tw | ru |
|---|---|---|---|---|
| `ebpfRawData` | `Raw data` | `原始数据` | `原始資料` | `Исходные данные` |

- [ ] **Step 4: 全量检查**

```bash
pnpm type-check && pnpm exec eslint . && pnpm -C fork-test type-check && pnpm -C fork-test test && pnpm build
rg -l "grpc-websockets|application/grpc-web" dist/assets/index-*.js || echo "main chunk clean"
```

- [ ] **Step 5: 浏览器验证**

- 启动：`node test/mock-server.mjs --port 19998 --version 'sing-box 1.15.0-alpha.6-reF1nd-moonfruit.2'`、`node fork-test/mock-singbox-api.mjs --port 19999 --upstream 19998`、`pnpm dev --port 5173 --strictPort`（均后台）。
- 用 chrome-devtools MCP 新开页面（不碰用户已有标签页），分别在 1400px 与 390px 宽度截图，保存到 scratchpad 的 `tools-redesign/` 目录：
  1. mock（`?hostname=127.0.0.1&port=19999`）：网络 tab（两列 / 单列）；Tailscale tab 的 peer 列表、peer 详情对话框（Ping 几秒后停止）、出口节点对话框；OpenVPN 和 OpenConnect tab 在 mock 下不可见（mock 返回空端点）。
  2. 用户本机实例（`?hostname=127.0.0.1&port=9999`，只读）：tab 只出现 网络 / Tailscale / OpenVPN；Tailscale 的过期标签；OpenVPN 的隧道行。不得切换出口节点、登出、跑网络质量测试或修改任何东西；Ping 一个 peer 几秒可以。
  3. 与 `scratchpad/tools-compare/B-*.png` 对照，确认风格一致。
- 结束时停掉所有自己启动的进程、关闭自己开的页面。

- [ ] **Step 6: 提交**

```bash
git add -A src/components/singbox/tools src/views/ToolsPage.vue src/assembly/singbox/tools src/i18n/singbox fork-test/singbox
git commit -m "feat(singbox): add eBPF tab and remove the old stacked tools cards"
```
