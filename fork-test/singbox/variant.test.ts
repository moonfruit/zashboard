import { detectSingboxVariant } from '@/assembly/singbox/variant'
import { describe, expect, it } from 'vitest'

describe('detectSingboxVariant', () => {
  it.each([
    ['sing-box 1.14.1', 'official'],
    ['sing-box 1.14.0-beta.17', 'official'],
    ['sing-box 1.15.0-alpha.6-reF1nd', 'refind'],
    ['sing-box 1.15.0-alpha.6-reF1nd.2', 'refind'],
    ['sing-box 1.15.0-alpha.6-ref1nd', 'refind'],
    ['sing-box 1.15.0-alpha.6-reF1nd-moonfruit', 'moonfruit'],
    ['sing-box 1.15.0-alpha.6-reF1nd.2-moonfruit.2', 'moonfruit'],
  ])('%s → %s', (version, variant) => {
    expect(detectSingboxVariant(version)).toBe(variant)
  })
})
