import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LogEntry, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { DetailPanel } from './DetailPanel'

const v: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'LOITER', armed: true, lat: 36, lon: 139, alt_rel: 81.6, alt_msl: 0, hdg: 0,
  ground_speed: 7.25, climb: 0, battery: { pct: 64, volt: 22.1, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
}
const at = (m: number) => new Date(2026, 9, 17, 10, m).getTime()
const entry = (id: number, over: Partial<LogEntry> = {}): LogEntry => ({ id, ts: at(id), sysid: 1, source: 'vehicle', severity: 'info', text: `m${id}`, ackable: false, acked_by: null, acked_at: null, ...over })
const entries: LogEntry[] = [
  entry(5, { severity: 'error', text: 'EKF failure', ackable: true }),
  entry(4, { source: 'link', severity: 'warn', text: 'comms_delay', ackable: true }),
  entry(3, { severity: 'warn', text: 'PreArm', ackable: true, acked_by: 'admin', acked_at: 1 }),
  entry(2, { text: 'older' }),
  entry(9, { sysid: 2, text: 'other vehicle' }),
]
const base = { vehicle: v, entries, onAck: () => {}, onOpenLog: () => {}, onClose: () => {}, onOpenCommands: () => {}, dict: t('ja') }

describe('DetailPanel', () => {
  it('shows the video placeholder, the three big values and the newest message of the vehicle', () => {
    render(<DetailPanel {...base} />)
    expect(screen.getByText('映像未接続')).toBeInTheDocument()
    expect(screen.getByTestId('alt')).toHaveTextContent('82')
    expect(screen.getByTestId('speed')).toHaveTextContent('7.3')
    expect(screen.getByTestId('batt')).toHaveTextContent('64')
    // every telemetry value has its caption, the battery too
    expect(screen.getByTestId('batt').parentElement).toHaveTextContent('バッテリー')
    const rows = screen.getAllByTestId('msg')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('10:05')
    expect(rows[0]).toHaveTextContent('EKF failure')
    expect(screen.queryByText('older')).toBeNull()
    expect(screen.queryByText('other vehicle')).toBeNull()
  })

  it('the header shows the flight mode and the arm state in words', () => {
    const { unmount } = render(<DetailPanel {...base} />)
    const head = screen.getByTestId('detail-state')
    expect(head).toHaveTextContent('LOITER')
    expect(head).toHaveTextContent('アーム中')
    unmount()
    render(<DetailPanel {...base} vehicle={{ ...v, armed: false }} />)
    expect(screen.getByTestId('detail-state')).toHaveTextContent('ディスアーム')
  })

  it('a rover shows its distance from home, not altitude, and its attitude for slopes (user 2026-11-01)', () => {
    render(<DetailPanel {...base} vehicle={{ ...v, kind: 'rover', lat: 36.001, lon: 139, home: { lat: 36, lon: 139, alt: 0 }, attitude: { roll: 1, pitch: 2 }, hdg: 87 }} />)
    expect(screen.queryByTestId('alt')).toBeNull()
    expect(screen.getByTestId('dist')).toHaveTextContent('111 m')
    expect(screen.getByText('ホームから')).toBeInTheDocument()
    const row = screen.getByTestId('instruments')
    expect(within(row).getByRole('img', { name: /姿勢/ })).toBeInTheDocument()
    expect(within(row).getByRole('img', { name: /方位/ })).toBeInTheDocument()
    expect(screen.getByTestId('instruments-values')).toHaveTextContent('方位 087°')
    expect(screen.getByTestId('instruments-values')).toHaveTextContent('ロール')
    expect(screen.getByTestId('instruments-values')).toHaveTextContent('ピッチ')
  })

  it('the battery reads a dash, not 0.0 V, without a battery monitor', () => {
    render(<DetailPanel {...base} vehicle={{ ...v, battery: { pct: null, volt: 0, current: null } }} />)
    expect(screen.getByTestId('batt')).toHaveTextContent('—')
  })

  it('the newest message row still shows the comms delay body', () => {
    render(<DetailPanel {...base} entries={entries.slice(1)} />)
    const rows = screen.getAllByTestId('msg')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('通信遅延')
    expect(rows[0]).toHaveTextContent('通信の応答が遅延しています。')
  })

  it('shows the attitude indicator and compass above the messages with a numeric line', () => {
    render(<DetailPanel {...base} vehicle={{ ...v, attitude: { roll: -12.3, pitch: 4.4 }, hdg: 87 }} />)
    const row = screen.getByTestId('instruments')
    expect(within(row).getByRole('img', { name: /姿勢/ })).toBeInTheDocument()
    expect(within(row).getByRole('img', { name: /方位/ })).toBeInTheDocument()
    expect(screen.getByTestId('instruments-values')).toHaveTextContent('ロール −12°ピッチ +4°方位 087°')
    const msg = screen.getAllByTestId('msg')[0]!
    expect(row.compareDocumentPosition(msg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('instruments show dashes when attitude and heading are unknown', () => {
    render(<DetailPanel {...base} vehicle={{ ...v, hdg: null }} />)
    expect(screen.getByTestId('instruments-values')).toHaveTextContent('ロール —ピッチ —方位 —')
    expect(screen.getByTestId('instruments').innerHTML).not.toContain('NaN')
  })

  it('only_alerts_have_an_ack_button', () => {
    render(<DetailPanel {...base} entries={[entry(2, { severity: 'info' }), entry(1, { source: 'command', severity: 'error', text: 'arm' })]} />)
    expect(screen.queryByRole('button', { name: '確認' })).toBeNull()
    expect(screen.queryByText('確認済み')).toBeNull()
  })

  it('ack_calls_the_api_and_marks_the_row', () => {
    const onAck = vi.fn()
    render(<DetailPanel {...base} onAck={onAck} />)
    const buttons = screen.getAllByRole('button', { name: '確認' })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveClass('ackbtn', 'err')
    fireEvent.click(buttons[0]!)
    expect(onAck).toHaveBeenCalledWith(1, 5)
    cleanup()
    render(<DetailPanel {...base} entries={entries.slice(2)} />)
    const rows = screen.getAllByTestId('msg')
    expect(rows[0]).toHaveClass('msg', 'warn', 'done')
    expect(rows[0]).toHaveTextContent('確認済み')
  })

  it('header_counts_pending_alerts', () => {
    const { rerender } = render(<DetailPanel {...base} />)
    expect(screen.getByTitle('確認待ちの警告')).toHaveTextContent('2')
    rerender(<DetailPanel {...base} entries={[entry(2)]} />)
    expect(screen.queryByTitle('確認待ちの警告')).toBeNull()
  })

  it('chevron_opens_the_filtered_history and the tiles open commands', () => {
    const onOpenLog = vi.fn()
    const onOpenCommands = vi.fn()
    render(<DetailPanel {...base} onOpenLog={onOpenLog} onOpenCommands={onOpenCommands} />)
    // the tile and the メッセージ chevron both open the vehicle's message history
    fireEvent.click(screen.getAllByRole('button', { name: 'メッセージ履歴' }).at(-1)!)
    expect(onOpenLog).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: /全コマンド/ }))
    expect(onOpenCommands).toHaveBeenCalledTimes(1)
  })

  it('the tiles carry a label, open maintenance / the filtered history, and show what needs attention', () => {
    const onOpenLog = vi.fn()
    const onOpenMaint = vi.fn()
    const { rerender } = render(<DetailPanel {...base} onOpenLog={onOpenLog} onOpenMaint={onOpenMaint} commandsOpen />)
    const tiles = screen.getByTestId('detail-tiles')
    const maint = within(tiles).getByRole('button', { name: /メンテナンス/ })
    const history = within(tiles).getByRole('button', { name: /メッセージ履歴/ })
    expect(maint).toHaveTextContent('メンテナンス')
    fireEvent.click(maint)
    expect(onOpenMaint).toHaveBeenCalledWith(1)
    fireEvent.click(history)
    expect(onOpenLog).toHaveBeenCalledWith(1)
    // the pending count shows once, on メッセージ, not again on the tile
    expect(within(history).queryByText('2')).toBeNull()
    expect(within(tiles).getByRole('button', { name: /全コマンド/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(maint).queryByTitle('校正の要確認があります')).toBeNull()
    rerender(<DetailPanel {...base} onOpenMaint={onOpenMaint} maintAttention />)
    expect(within(screen.getByTestId('detail-tiles')).getByTitle('校正の要確認があります')).toBeInTheDocument()
  })

  it('the pin keeps the panel on this vehicle', () => {
    const onTogglePin = vi.fn()
    const { rerender } = render(<DetailPanel {...base} pinned={false} onTogglePin={onTogglePin} />)
    const pin = screen.getByRole('button', { name: 'この機体に固定' })
    expect(pin).toBeEnabled()
    expect(pin).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(pin)
    expect(onTogglePin).toHaveBeenCalledWith(1)
    rerender(<DetailPanel {...base} pinned onTogglePin={onTogglePin} />)
    expect(screen.getByRole('button', { name: '固定を解除' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '固定を解除' })).toHaveClass('on')
  })

  it('empty_state', () => {
    render(<DetailPanel {...base} entries={[]} />)
    expect(screen.getByText('メッセージはありません')).toBeInTheDocument()
  })

  it('detail_panel_renders_the_progress_row_when_a_mission_is_known', () => {
    const mission = { id: 1, name: 'm', sysid: 1, default_alt: 60, default_frame: 'rel' as const, speed: 8, home: null, fence: [], rally: [], surveys: [], items: [] }
    const onWriteMission = vi.fn()
    const { rerender } = render(
      <DetailPanel {...base} entries={[]} onWriteMission={onWriteMission} onStartMission={() => {}} />,
    )
    expect(screen.getByTestId('mission-progress')).toHaveTextContent('—')
    rerender(
      <DetailPanel {...base} entries={[]} vehicleMission={mission} missionProgress={{ seq: 1, total: 1 }} onWriteMission={onWriteMission} onStartMission={() => {}} />,
    )
    expect(screen.getByTestId('mission-progress')).toHaveTextContent('WP 1 / 0')
  })
  it('emergency buttons send pause / RTL / land to the shown vehicle and show their state', () => {
    const onCommand = vi.fn()
    render(<DetailPanel {...base} onCommand={onCommand} feedback={(cmd) => (cmd === 'rtl' ? 'sending' : null)} />)
    const row = screen.getByRole('group', { name: '緊急操作' })
    expect([...row.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['一時停止', '帰還', '着陸'])
    fireEvent.click(screen.getByRole('button', { name: '一時停止' }))
    expect(onCommand).toHaveBeenLastCalledWith({ cmd: 'pause' })
    fireEvent.click(screen.getByRole('button', { name: '着陸' }))
    expect(onCommand).toHaveBeenLastCalledWith({ cmd: 'land' })
    expect(screen.getByRole('button', { name: '帰還' }).className).toContain('sending')
  })
  it('a rover has no 着陸 in the emergency row', () => {
    render(<DetailPanel {...base} vehicle={{ ...v, kind: 'rover', mode: 'AUTO' }} onCommand={() => {}} />)
    const row = screen.getByRole('group', { name: '緊急操作' })
    expect([...row.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['一時停止', '帰還'])
  })

  it('emergency buttons stay usable but marked when the link is lost', () => {
    render(<DetailPanel {...base} vehicle={{ ...v, link: 'lost' }} onCommand={() => {}} />)
    const b = screen.getByRole('button', { name: '一時停止' })
    expect(b).toBeEnabled()
    expect(b.className).toContain('stale')
  })
})

describe('DetailPanel video maximize', () => {
  it('the thumbnail maximize button opens the cockpit for this vehicle', () => {
    const onMaximize = vi.fn()
    render(<DetailPanel {...base} onMaximize={onMaximize} />)
    fireEvent.click(screen.getByRole('button', { name: '最大化' }))
    expect(onMaximize).toHaveBeenCalledWith(1)
  })
})
