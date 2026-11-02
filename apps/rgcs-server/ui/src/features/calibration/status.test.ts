import { describe, expect, it } from 'vitest'
import { t } from '../../shared/i18n'
import type { CalibRecord } from '../../shared/api/types'
import { calibKinds, cardStatus, motorCount, needsAttention, STALE_MS } from './status'

const dict = t('ja')
const day = 86_400_000
const now = Date.UTC(2026, 9, 20, 3)
const rec = (over: Partial<CalibRecord>): CalibRecord => ({ kind: 'compass', ok: true, at: now - day, operator: 'op', detail: null, ...over })

describe('cardStatus', () => {
  it('shows the date of a recent success in green, in JST', () => {
    expect(cardStatus('compass', rec({ at: Date.UTC(2026, 9, 1, 16) }), now, dict)).toEqual({ tone: 'ok', text: '校正済み · 2026/10/02' })
  })
  it('turns amber after 30 days', () => {
    expect(cardStatus('compass', rec({ at: now - STALE_MS - 1 }), now, dict)).toEqual({ tone: 'warn', text: '要確認 · 30日以上経過' })
  })
  it('shows a failed last run in red and a missing one as not run', () => {
    expect(cardStatus('level', rec({ kind: 'level', ok: false, at: Date.UTC(2026, 9, 19) }), now, dict)).toEqual({ tone: 'err', text: '失敗 · 2026/10/19' })
    expect(cardStatus('rc', undefined, now, dict)).toEqual({ tone: 'idle', text: '未実施' })
  })
  it('a motor test is never stale, only run', () => {
    expect(cardStatus('motor', rec({ kind: 'motor', at: now - 90 * day }), now, dict).tone).toBe('ok')
    expect(cardStatus('motor', rec({ kind: 'motor', at: Date.UTC(2026, 9, 19) }), now, dict).text).toBe('実施済み · 2026/10/19')
  })
})

describe('calibKinds', () => {
  it('copters get every card; planes have no ESC calibration or motor test; QuadPlanes keep the motor test', () => {
    expect(calibKinds('copter', false)).toEqual(['accel', 'compass', 'level', 'rc', 'esc', 'motor'])
    expect(calibKinds('plane', false)).toEqual(['accel', 'compass', 'level', 'rc'])
    expect(calibKinds('plane', true)).toEqual(['accel', 'compass', 'level', 'rc', 'motor'])
    expect(calibKinds('rover', false)).toEqual(['accel', 'compass', 'level', 'rc'])
  })
})

describe('motorCount', () => {
  it('follows FRAME_CLASS (Q_FRAME_CLASS on a QuadPlane)', () => {
    expect(motorCount({ FRAME_CLASS: 1 })).toBe(4)
    expect(motorCount({ FRAME_CLASS: 2 })).toBe(6)
    expect(motorCount({ FRAME_CLASS: 3 })).toBe(8)
    expect(motorCount({ FRAME_CLASS: 4 })).toBe(8)
    expect(motorCount({ FRAME_CLASS: 5 })).toBe(6)
    expect(motorCount({ FRAME_CLASS: 7 })).toBe(3)
    expect(motorCount({ Q_FRAME_CLASS: 2 })).toBe(6)
    expect(motorCount({})).toBe(4)
  })
})

describe('needsAttention', () => {
  it('flags a failed or stale calibration, never a missing one or an old motor test', () => {
    expect(needsAttention([], now)).toBe(false)
    expect(needsAttention([rec({ at: now - day })], now)).toBe(false)
    expect(needsAttention([rec({ ok: false })], now)).toBe(true)
    expect(needsAttention([rec({ at: now - STALE_MS - 1 })], now)).toBe(true)
    expect(needsAttention([rec({ kind: 'motor', at: now - STALE_MS - 1 })], now)).toBe(false)
  })
})
