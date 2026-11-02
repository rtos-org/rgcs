import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LogEntry } from '../shared/api/types'
import { t } from '../shared/i18n'
import { EMPTY_LOG, type LogState } from '../features/log/store'
import { Footer } from './Footer'

const at = (h: number, m: number) => new Date(2026, 9, 17, h, m).getTime()
const entry = (over: Partial<LogEntry>): LogEntry => ({
  id: 1,
  ts: at(14, 7),
  sysid: 1,
  source: 'vehicle',
  severity: 'warn',
  text: 'PreArm: GPS',
  ackable: true,
  acked_by: null,
  acked_at: null,
  ...over,
})
const names = new Map([[1, 'UAV-01']])

function renderFooter(log: LogState, extra: Partial<Parameters<typeof Footer>[0]> = {}) {
  const onToggle = vi.fn()
  render(<Footer log={log} names={names} dict={t('ja')} clock="14:08" lead onToggle={onToggle} {...extra} />)
  return onToggle
}

describe('Footer', () => {
  it('shows the lead, the newest entry with icon, time, source and text, and the clock', () => {
    renderFooter({
      ...EMPTY_LOG,
      entries: [entry({ id: 2 }), entry({ id: 1, text: 'old' })],
    })
    const pill = screen.getByRole('button', { name: /メッセージ履歴/ })
    expect(pill).toHaveClass('logpill')
    expect(pill).toHaveTextContent('全機')
    expect(pill).toHaveTextContent('14:07')
    expect(pill).toHaveTextContent('UAV-01')
    expect(pill).toHaveTextContent('PreArm: GPS')
    expect(pill).not.toHaveTextContent('old')
    expect(pill.querySelector('svg.sev-warn')).not.toBeNull()
    expect(screen.getByText('14:08')).not.toHaveClass('logpill')
  })

  it('translates command and link entries; entries without a vehicle are the system', () => {
    renderFooter({
      ...EMPTY_LOG,
      entries: [
        entry({
          source: 'command',
          severity: 'error',
          text: 'rtl timeout',
          sysid: null,
        }),
      ],
    })
    const pill = screen.getByRole('button', { name: /メッセージ履歴/ })
    expect(pill).toHaveTextContent('システム')
    expect(pill).toHaveTextContent('帰還 失敗 タイムアウト')
  })

  it('shows the unread badge only when there are unread alerts', () => {
    renderFooter({ ...EMPTY_LOG, entries: [entry({})], unreadAlerts: 3 })
    expect(screen.getByTitle('未読の警告')).toHaveTextContent('3')
  })

  it('has no badge and no lead in maintenance, and toggles on click', () => {
    const onToggle = renderFooter({ ...EMPTY_LOG, entries: [entry({})] }, { lead: false })
    expect(screen.queryByTitle('未読の警告')).toBeNull()
    const pill = screen.getByRole('button', { name: /メッセージ履歴/ })
    expect(pill).not.toHaveTextContent('全機')
    fireEvent.click(pill)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('shows a lost joystick as the newest line', () => {
    renderFooter({ ...EMPTY_LOG, entries: [entry({})] }, { deadmanLost: true })
    expect(screen.getByRole('button', { name: /メッセージ履歴/ })).toHaveTextContent('ジョイスティック切断')
  })
})
