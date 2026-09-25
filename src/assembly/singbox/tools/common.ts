import { proxyMap } from '@/assembly/proxies'
import { ConnectError } from '@connectrpc/connect'
import { computed } from 'vue'

export type StreamingRun = {
  cancel: () => void
  done: Promise<void>
}

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

export const toolErrorMessage = (error: unknown) => ConnectError.from(error).rawMessage

export const safeHttpUrl = (url: string): string => (/^https?:\/\//i.test(url) ? url : '')

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
