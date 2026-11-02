import { describe, expect, it } from 'vitest'
import { t } from '../../shared/i18n'
import { jstDate, jstTime, minutesText, monthRange, placeText, splitList, todayJst } from './format'

describe('logbook format', () => {
  it('formats_dates_and_times_in_jst', () => {
    expect(jstDate(1_700_000_000_000)).toBe('2023-11-15')
    expect(jstTime(1_700_000_000_000)).toBe('07:13')
  })

  it('place_falls_back_to_coordinates', () => {
    expect(placeText('熊谷市', 35.481883, 138.48029)).toBe('熊谷市')
    expect(placeText('', 35.481883, 138.48029)).toBe('35.48188, 138.48029')
    expect(placeText('', null, null)).toBe('')
  })

  it('month_range_runs_from_the_first_to_today', () => {
    expect(monthRange(new Date('2026-12-15T00:00:00+09:00'))).toEqual({ from: '2026-12-01', to: '2026-12-15' })
    expect(monthRange(new Date('2026-12-31T23:30:00+09:00'))).toEqual({ from: '2026-12-01', to: '2026-12-31' })
    expect(todayJst(new Date('2026-01-01T00:30:00+09:00'))).toBe('2026-01-01')
  })

  it('minutes_and_lists', () => {
    expect(minutesText(12, t('ja'))).toBe('12 分')
    expect(splitList('空撮|報道取材|その他')).toEqual(['空撮', '報道取材', 'その他'])
    expect(splitList('')).toEqual([])
  })
})
