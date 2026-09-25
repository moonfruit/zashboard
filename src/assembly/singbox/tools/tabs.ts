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

export const pendingChallengeCount = (endpoints: { challenge?: unknown }[]): number =>
  endpoints.filter((endpoint) => endpoint.challenge !== undefined).length

export const challengeBadge = (endpoints: { challenge?: unknown }[]): number | undefined => {
  const count = pendingChallengeCount(endpoints)
  return count > 0 ? count : undefined
}
