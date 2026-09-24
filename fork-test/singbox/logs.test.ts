import { getLogConnectionID, getSingboxLogType } from '@/assembly/singbox/logs'
import { describe, expect, it } from 'vitest'

describe('getSingboxLogType', () => {
  it('extracts tag type with connection prefix', () => {
    expect(getSingboxLogType('[3829292130 5ms] router: match[0] => direct')).toBe('router:')
  })

  it('extracts tag type without connection prefix', () => {
    expect(getSingboxLogType('inbound/tun[tun-in]: started at utun9')).toBe('inbound/tun[tun-in]:')
  })

  it('returns empty type when no tag', () => {
    expect(getSingboxLogType('sing-box started (0.12s)')).toBe('')
    expect(getSingboxLogType('[42 1ms] closed')).toBe('')
  })
})

describe('getLogConnectionID', () => {
  it('extracts connection id', () => {
    expect(getLogConnectionID('[3829292130 5ms] router: match[0]')).toBe('3829292130')
    expect(getLogConnectionID('[3829292130 1.2s] outbound/vless[proxy]: x')).toBe('3829292130')
  })

  it('returns null without connection prefix', () => {
    expect(getLogConnectionID('router: updated')).toBeNull()
    expect(getLogConnectionID('[warn] something')).toBeNull()
  })
})
