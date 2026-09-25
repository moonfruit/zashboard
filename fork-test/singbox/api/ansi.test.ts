import {
  highlightSegments,
  matchedRanges,
  parseAnsi,
  replaceAnsiText,
  sliceSegments,
  stripAnsi,
} from '@/assembly/singbox/ansi'
import { describe, expect, it } from 'vitest'

const ESC = String.fromCharCode(27)
const sgr = (codes: string) => `${ESC}[${codes}m`

describe('parseAnsi', () => {
  it('returns one plain segment without escapes', () => {
    expect(parseAnsi('hello')).toEqual([{ text: 'hello' }])
  })

  it('parses basic, bright and reset', () => {
    expect(parseAnsi(`${sgr('31')}ERROR${sgr('0')} ${sgr('1;94')}x`)).toEqual([
      { text: 'ERROR', fg: 'ansi-1' },
      { text: ' ' },
      { text: 'x', fg: 'ansi-12', bold: true },
    ])
  })

  it('parses 256 colors and true color', () => {
    expect(
      parseAnsi(`${sgr('38;5;196')}a${sgr('38;5;9')}b${sgr('38;5;244')}c${sgr('48;2;1;2;255')}d`),
    ).toEqual([
      { text: 'a', fg: '#ff0000' },
      { text: 'b', fg: 'ansi-9' },
      { text: 'c', fg: '#808080' },
      { text: 'd', fg: '#808080', bg: '#0102ff' },
    ])
  })

  it('handles attribute resets, empty params and unknown sequences', () => {
    expect(
      parseAnsi(
        `${sgr('1;3;4')}a${sgr('22;23;24')}b${sgr('')}c${ESC}[2Kd${sgr('5')}e${sgr('39;49')}f`,
      ),
    ).toEqual([
      { text: 'a', bold: true, italic: true, underline: true },
      { text: 'b' },
      { text: 'c' },
      { text: 'd' },
      { text: 'e' },
      { text: 'f' },
    ])
  })

  it('discards unparseable extended color params without leaking them as attributes', () => {
    expect(parseAnsi(`${sgr('38;2;1')}x`)).toEqual([{ text: 'x' }])
    expect(parseAnsi(`${sgr('38;5')}${sgr('1')}y`)).toEqual([{ text: 'y', bold: true }])
  })

  it('drops a truncated escape sequence at the end of the input', () => {
    expect(parseAnsi(`${sgr('31')}abc${ESC}[38;5`)).toEqual([{ text: 'abc', fg: 'ansi-1' }])
    expect(parseAnsi(`abc${ESC}[`)).toEqual([{ text: 'abc' }])
    expect(parseAnsi(`abc${ESC}`)).toEqual([{ text: 'abc' }])
    expect(parseAnsi(`${ESC}[1`)).toEqual([])
    expect(parseAnsi(`abc${ESC}[?25`)).toEqual([{ text: 'abc' }])
    expect(parseAnsi(`a?b${ESC}[1mc`)).toEqual([{ text: 'a?b' }, { text: 'c', bold: true }])
  })
})

describe('segment helpers', () => {
  const segments = parseAnsi(
    `${sgr('36')}INFO[0012]${sgr('0')} [${sgr('38;5;208')}123 5ms${sgr('0')}] dns: ok`,
  )

  it('strips and slices', () => {
    expect(stripAnsi(segments)).toBe('INFO[0012] [123 5ms] dns: ok')
    expect(stripAnsi(sliceSegments(segments, 11))).toBe('[123 5ms] dns: ok')
    expect(sliceSegments(segments, 11)[0]).toEqual({ text: '[' })
    expect(sliceSegments(segments, 12)[0]).toEqual({ text: '123 5ms', fg: '#ff8700' })
  })

  it('replaces text across segment boundaries and keeps untouched styles', () => {
    const input = parseAnsi(`${sgr('31')}10.0.0.2${sgr('0')}${sgr('32')}:5000${sgr('0')} x`)
    const matchers: [RegExp, string][] = [[/10\.0\.0\.2:/gi, '10.0.0.2 (home) :']]
    const result = replaceAnsiText(input, matchers)

    expect(stripAnsi(result)).toBe(stripAnsi(input).replace(matchers[0][0], matchers[0][1]))
    expect(result).toEqual([
      { text: '10.0.0.2 (home) :', fg: 'ansi-1' },
      { text: '5000', fg: 'ansi-2' },
      { text: ' x' },
    ])
  })

  it('applies multiple matches and matchers like the string replacement', () => {
    const input = parseAnsi(`a ${sgr('36')}1.1.1.1:${sgr('0')}1 b 2.2.${sgr('1')}2.2:2 c 1.1.1.1:3`)
    const matchers: [RegExp, string][] = [
      [/1\.1\.1\.1:/gi, '1.1.1.1 (one) :'],
      [/2\.2\.2\.2:/gi, '2.2.2.2 (two) :'],
    ]
    const result = replaceAnsiText(input, matchers)
    const expected = matchers.reduce(
      (text, [regex, label]) => text.replace(regex, label),
      stripAnsi(input),
    )

    expect(stripAnsi(result)).toBe(expected)
    expect(result.find((part) => part.text.includes('(one)'))?.fg).toBe('ansi-6')
    expect(result.find((part) => part.text.includes('(two)'))?.bold).toBeUndefined()
    expect(result.find((part) => part.text.startsWith('2 c'))?.bold).toBe(true)
  })

  it('returns the segments unchanged without a match', () => {
    const input = parseAnsi(`${sgr('31')}abc${sgr('0')} def`)

    expect(replaceAnsiText(input, [[/xyz/gi, 'q']])).toEqual(input)
    expect(replaceAnsiText(input, [])).toEqual(input)
  })

  it('highlights ranges across segment boundaries', () => {
    const parts = [
      { text: 'INFO[00', matched: false },
      { text: '12] [1', matched: true },
      { text: '23 5ms] dns: ok', matched: false },
    ]
    const ranges = matchedRanges(parts)
    const result = highlightSegments(segments, ranges)

    expect(ranges).toEqual([[7, 13]])
    expect(result.map((part) => part.text).join('')).toBe(stripAnsi(segments))
    expect(result.filter((part) => part.matched).map((part) => part.text)).toEqual([
      '12]',
      ' [',
      '1',
    ])
    expect(result.find((part) => part.text === '12]')?.fg).toBe('ansi-6')
  })
})
