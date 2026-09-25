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

const PREFIX = /^[A-Z]+(?:\[(\d+)\])? /

export const toLogLevel = (level: number) => BY_PB_LEVEL[level] ?? LOG_LEVEL.Info

export const passesLevel = (type: string, selected: string) => {
  if (selected === LOG_LEVEL.Silent) return false

  const minimum = SEVERITY.indexOf(selected)

  return minimum === -1 || SEVERITY.indexOf(type) >= minimum
}

export const toLog = (message: { level: number; message: string }, baseMs?: number): Log => {
  const segments = parseAnsi(message.message)
  const plain = stripAnsi(segments)
  const match = PREFIX.exec(plain)
  const prefix = match?.[0].length ?? 0
  const log: Log = {
    type: toLogLevel(message.level),
    payload: plain.slice(prefix),
    ansi: sliceSegments(segments, prefix),
  }

  if (baseMs && match?.[1] !== undefined) log.timestamp = baseMs + Number(match[1]) * 1000
  return log
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
