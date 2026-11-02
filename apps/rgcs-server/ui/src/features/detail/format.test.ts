import { describe, expect, it } from 'vitest'
import { t } from '../../shared/i18n'
import { messageText } from './format'

describe('message formatting', () => {
  it('translates link codes and keeps vehicle text verbatim', () => {
    const d = t('ja')
    expect(messageText('comms_delay', d)).toBe('通信遅延')
    expect(messageText('link_lost', d)).toBe('通信喪失')
    expect(messageText('link_restored', d)).toBe('通信復帰')
    expect(messageText('auto_record_failed', d)).toBe('自動録画を開始できませんでした')
    expect(messageText('auto_record_failed', t('en'))).toBe('Auto record could not start')
    expect(messageText('PreArm: Compass not calibrated', d)).toBe('PreArm: Compass not calibrated')
  })
})
