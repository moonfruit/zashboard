export type AnsiStyle = {
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

export type AnsiSegment = AnsiStyle & { text: string }

export type SingboxConnectionRawMessage = {
  id: string
  inbound: string
  inboundType: string
  ipVersion: number
  network: string
  source: string
  destination: string
  domain: string
  sniffHost: string
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
