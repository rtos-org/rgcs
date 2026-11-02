import { describe, expect, it } from 'vitest'
import { dateTimeText, hhmm, hhmmss } from './time'
import * as time from './time'

describe('clock formats', () => {
  it('pads hours, minutes and seconds in local time', () => {
    const ts = new Date(2026, 9, 18, 9, 5, 7).getTime()
    expect(hhmm(ts)).toBe('09:05')
    expect(hhmmss(ts)).toBe('09:05:07')
  })
})

describe('local date-time', () => {
  it('formats YYYY-MM-DD HH:MM in the browser zone', () => {
    expect(dateTimeText(new Date(2025, 9, 25, 22, 46, 40).getTime())).toBe('2025-10-25 22:46')
    expect(dateTimeText(new Date(2026, 0, 1, 0, 0).getTime())).toBe('2026-01-01 00:00')
  })

  it('has_no_fixed_time_zone_helpers_left', () => {
    expect(Object.keys(time).filter((k) => /jst/i.test(k))).toEqual([])
  })
})

describe('app date-time', () => {
  it('formats YYYY/MM/DD HH:MM in local time like the header clock', async () => {
    const { ymdHm } = await import('./time')
    expect(ymdHm(new Date(2026, 9, 23, 23, 36, 24).getTime())).toBe('2026/10/23 23:36')
    expect(ymdHm(new Date(2026, 0, 2, 3, 4).getTime())).toBe('2026/01/02 03:04')
  })
})

describe('message stamps', () => {
  it('today shows the time; yesterday says so; older shows the date', async () => {
    const { msgStamp } = await import('./time')
    const now = new Date(2026, 9, 26, 13, 47).getTime()
    expect(msgStamp(new Date(2026, 9, 26, 9, 5, 7).getTime(), now, '昨日')).toBe('09:05:07')
    expect(msgStamp(new Date(2026, 9, 25, 21, 29, 32).getTime(), now, '昨日')).toBe('昨日 21:29')
    expect(msgStamp(new Date(2026, 9, 20, 8, 1).getTime(), now, '昨日')).toBe('10/20 08:01')
  })
})
