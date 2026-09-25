import type { AnsiSegment, AnsiStyle } from '@/types'

export type { AnsiSegment, AnsiStyle }

export type HighlightedSegment = AnsiSegment & { matched: boolean }

const ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[([0-9;]*)([A-Za-z])`, 'g')
const TRUNCATED_ESCAPE = new RegExp(`${String.fromCharCode(27)}(\\[[0-9;?<=>]*)?$`)
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
  return [undefined, codes.length - start]
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

  push(input.slice(last).replace(TRUNCATED_ESCAPE, ''))
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

const rangeSegments = (segments: AnsiSegment[], start: number, end: number): AnsiSegment[] => {
  const result: AnsiSegment[] = []
  let offset = 0

  for (const segment of segments) {
    const stop = offset + segment.text.length
    const from = Math.max(start, offset)
    const to = Math.min(end, stop)

    if (to > from) result.push({ ...segment, text: segment.text.slice(from - offset, to - offset) })
    offset = stop
  }

  return result
}

const segmentAt = (segments: AnsiSegment[], position: number) => {
  let offset = 0

  for (const segment of segments) {
    offset += segment.text.length
    if (position < offset) return segment
  }

  return segments[segments.length - 1] ?? { text: '' }
}

const replaceSegments = (segments: AnsiSegment[], regex: RegExp, replacement: string) => {
  const text = stripAnsi(segments)
  const single = new RegExp(regex.source, regex.flags.replace('g', ''))
  const edits: [number, number, string][] = []

  text.replace(regex, (...args: unknown[]) => {
    const match = args[0] as string
    const offset = args.find((arg) => typeof arg === 'number') as number

    edits.push([offset, offset + match.length, match.replace(single, replacement)])
    return match
  })

  if (edits.length === 0) return segments

  const result: AnsiSegment[] = []
  let cursor = 0

  for (const [from, to, value] of edits) {
    result.push(...rangeSegments(segments, cursor, from))
    if (value) result.push({ ...segmentAt(segments, from), text: value })
    cursor = to
  }

  result.push(...rangeSegments(segments, cursor, text.length))
  return result
}

export const replaceAnsiText = (segments: AnsiSegment[], matchers: [RegExp, string][]) =>
  matchers.reduce((current, [regex, label]) => replaceSegments(current, regex, label), segments)

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
