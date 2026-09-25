import { safeHttpUrl } from '@/assembly/singbox/tools/common'
import { describe, expect, it } from 'vitest'

describe('safeHttpUrl', () => {
  it('keeps http and https urls', () => {
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com')
    expect(safeHttpUrl('https://example.com/path?a=1')).toBe('https://example.com/path?a=1')
    expect(safeHttpUrl('HTTPS://example.com')).toBe('HTTPS://example.com')
  })

  it('rejects javascript, data and relative urls', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBe('')
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe('')
    expect(safeHttpUrl('/relative/path')).toBe('')
    expect(safeHttpUrl('')).toBe('')
  })
})
