import { describe, expect, it } from 'vitest'
import { angleText, recDuration, zoomText } from './format'

describe('camera formatting', () => {
  it('formats zoom, angles and recording duration', () => {
    expect(zoomText(2.5)).toBe('2.5×')
    expect(zoomText(1)).toBe('1.0×')
    expect(zoomText(1.5)).toBe('1.5×')
    expect(zoomText(40, 'percent')).toBe('40%')
    expect(zoomText(12.6, 'percent')).toBe('13%')
    expect(angleText(-30)).toBe('−30.0°')
    expect(angleText(12.34)).toBe('12.3°')
    expect(recDuration(0, 83_000)).toBe('01:23')
    expect(recDuration(0, 3_725_000)).toBe('1:02:05')
  })
})
