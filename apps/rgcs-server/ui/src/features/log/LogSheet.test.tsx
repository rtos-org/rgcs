import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LogEntry } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { EMPTY_LOG } from './store'
import { LogSheet } from './LogSheet'

const entry = (id: number, over: Partial<LogEntry> = {}): LogEntry => ({
  id,
  ts: id * 60_000,
  sysid: 1,
  source: 'vehicle',
  severity: 'info',
  text: `m${id}`,
  ackable: false,
  acked_by: null,
  acked_at: null,
  ...over,
})
const entries = [
  entry(4, { severity: 'error', sysid: 2 }),
  entry(3, { severity: 'warn' }),
  entry(2, { source: 'link', text: 'link_lost', severity: 'error' }),
  entry(1, { sysid: null, source: 'system' }),
]
const names = new Map([
  [1, 'UAV-01'],
  [2, 'UAV-02'],
])

describe('LogSheet', () => {
  it('lists every entry with source, translated text and a count; bold alerts', () => {
    render(<LogSheet log={{ ...EMPTY_LOG, open: true, entries }} names={names} dict={t('ja')} onFilter={vi.fn()} onClose={vi.fn()} />)
    const rows = screen.getAllByTestId('logrow')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveClass('logrow', 'error')
    expect(within(rows[0]).getByText('UAV-02')).toHaveClass('src')
    expect(rows[2]).toHaveTextContent('通信喪失')
    expect(within(rows[3]).getByText('システム')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('直近 500 件を表示しています。')).toBeInTheDocument()
  })

  it('filters to alerts and to one vehicle, whose name becomes a filter button', () => {
    const onFilter = vi.fn()
    const { rerender } = render(<LogSheet log={{ ...EMPTY_LOG, open: true, entries, filter: 'alerts' }} names={names} dict={t('ja')} onFilter={onFilter} onClose={vi.fn()} />)
    expect(screen.getAllByTestId('logrow')).toHaveLength(3)
    expect(screen.getByRole('button', { name: '警告・エラー' })).toHaveClass('on')
    fireEvent.click(screen.getByRole('button', { name: 'すべて' }))
    expect(onFilter).toHaveBeenCalledWith('all')
    rerender(<LogSheet log={{ ...EMPTY_LOG, open: true, entries, filter: 2 }} names={names} dict={t('ja')} onFilter={onFilter} onClose={vi.fn()} />)
    expect(screen.getAllByTestId('logrow')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'UAV-02' })).toHaveClass('on')
  })

  it('shows the empty text and closes', () => {
    const onClose = vi.fn()
    render(<LogSheet log={{ ...EMPTY_LOG, open: true }} names={names} dict={t('ja')} onFilter={vi.fn()} onClose={onClose} />)
    expect(screen.getByText('メッセージはありません')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalled()
  })
  it('a vehicle name jumps to that vehicle; system rows have no link', () => {
    const onFocusVehicle = vi.fn()
    render(<LogSheet log={{ ...EMPTY_LOG, open: true, entries }} names={names} dict={t('ja')} onFilter={vi.fn()} onClose={vi.fn()} onFocusVehicle={onFocusVehicle} />)
    fireEvent.click(screen.getByRole('button', { name: 'UAV-02' }))
    expect(onFocusVehicle).toHaveBeenCalledWith(2)
    expect(screen.queryByRole('button', { name: 'システム' })).toBeNull()
  })
})
