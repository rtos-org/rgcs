import { describe, expect, it } from 'vitest'
import { t } from '../../shared/i18n'
import { progressPct, progressText } from './format'

const dict = t('ja')

describe('parameter progress', () => {
  it('a cached list reads as the last download, not 0 / n', () => {
    const idle = { received: 0, total: 1431, complete: false, downloading: false }
    expect(progressText(idle, 1431, dict)).toBe('1431 件 (前回取得)')
    expect(progressPct(idle, 1431)).toBeNull()
  })
  it('a running download shows received / total and its bar', () => {
    const run = { received: 200, total: 1431, complete: false, downloading: true }
    expect(progressText(run, 1431, dict)).toBe('200 / 1431')
    expect(progressPct(run, 1431)).toBe(14)
  })
  it('nothing known reads a dash', () => {
    expect(progressText(null, 0, dict)).toBe('–')
  })
})
