import { describe, expect, it } from 'vitest'
import { t } from '../../shared/i18n'
import { AXIS_FUNCTIONS, BUTTON_FUNCTIONS } from '../gimbal-joystick/profile'
import { axisFnLabel, buttonFnLabel } from './fnLabels'

describe('joystick function labels', () => {
  it('every axis and button function reads as words in both languages, never the raw id', () => {
    for (const lang of ['ja', 'en'] as const) {
      const dict = t(lang)
      for (const f of AXIS_FUNCTIONS) expect(axisFnLabel(f, dict)).not.toBe(f)
      for (const f of BUTTON_FUNCTIONS) expect(buttonFnLabel(f, dict), f).not.toMatch(/_|^none$|^shutter$/)
    }
  })
  it('uses the agreed copy', () => {
    const ja = t('ja')
    expect(axisFnLabel('pan', ja)).toBe('パン')
    expect(axisFnLabel('none', ja)).toBe('なし')
    expect(buttonFnLabel('record_toggle', ja)).toBe('録画 開始/停止')
    expect(buttonFnLabel('roi_3', ja)).toBe('ROI 3 を追跡')
    expect(buttonFnLabel('center_gimbal', t('en'))).toBe('Center gimbal')
  })
})
