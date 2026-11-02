import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LogEntry, VehicleCommand, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { CommandDock } from './CommandDock'
import { useCommandRunner, type RunnerDeps } from './useCommandRunner'

interface HarnessProps {
  readonly vehicle: VehicleState
  readonly entries: LogEntry[]
  readonly dict: ReturnType<typeof t>
  readonly onClose: () => void
  readonly onOpenGuided: (sysid: number) => void
  readonly onError: (sysid: number, command: VehicleCommand, message: string) => void
  readonly deps: RunnerDeps
}

/** The Shell's wiring: one runner, the dock and the runner's confirm modal. */
function Harness({ vehicle, entries, dict, onClose, onOpenGuided, onError, deps }: HarnessProps) {
  const runner = useCommandRunner({ entries, dict, vehicleOf: (s) => (s === vehicle.sysid ? vehicle : undefined), onError, deps })
  return (
    <>
      <CommandDock vehicle={vehicle} entries={entries} dict={dict} onClose={onClose} onOpenGuided={onOpenGuided} runner={runner} />
      {runner.confirm}
    </>
  )
}

const v = (sysid: number, armed = false): VehicleState => ({
  sysid, name: `UAV-0${sysid}`, kind: 'copter', mode: 'LOITER', armed, lat: 0, lon: 0, alt_rel: 0, alt_msl: 0, hdg: null,
  ground_speed: 0, climb: 0, battery: { pct: 50, volt: 22, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 10, hdop: 1 }, warn: false, unread: 0,
})

function setup(vehicle: VehicleState, entries: LogEntry[] = []) {
  const send = vi.fn(async () => ({ id: 7 }))
  const confirm = vi.fn(async () => ({ confirm_token: 'tok', expires_in: 30 }))
  const onClose = vi.fn()
  const onOpenGuided = vi.fn()
  const props = { dict: t('ja'), entries, onClose, onOpenGuided, deps: { send, confirm }, onError: vi.fn() }
  const view = render(<Harness vehicle={vehicle} {...props} />)
  return { send, confirm, onClose, onOpenGuided, rerender: (next: VehicleState) => view.rerender(<Harness vehicle={next} {...props} />) }
}

const panel = () => screen.getByRole('complementary', { name: '全コマンド' })

describe('CommandDock', () => {
  it('the_panel_stays_open_after_a_command', async () => {
    const { send, onClose } = setup(v(1, true))
    fireEvent.click(within(panel()).getByRole('button', { name: /一時停止/ }))
    await waitFor(() => expect(send).toHaveBeenCalledWith(1, { cmd: 'pause' }, undefined))
    expect(panel()).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a_confirm_command_opens_a_modal_over_the_panel_and_the_panel_stays', async () => {
    const { send, confirm } = setup(v(1))
    fireEvent.click(within(panel()).getByRole('button', { name: 'アーム' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.closest('.modal-backdrop')).not.toBeNull()
    expect(panel()).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '実行' }))
    await waitFor(() => expect(send).toHaveBeenCalledWith(1, { cmd: 'arm' }, 'tok'))
    expect(confirm).toHaveBeenCalledWith(1, 'arm')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(panel()).toBeInTheDocument()
  })

  it('cancelling_the_confirm_keeps_the_panel', async () => {
    const { send } = setup(v(1))
    fireEvent.click(within(panel()).getByRole('button', { name: 'アーム' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(panel()).toBeInTheDocument()
    expect(send).not.toHaveBeenCalled()
  })

  it('commands_go_to_the_currently_selected_vehicle', async () => {
    const { send, rerender } = setup(v(1, true))
    rerender(v(2, true))
    expect(within(panel()).getByText('UAV-02')).toBeInTheDocument()
    fireEvent.click(within(panel()).getByRole('button', { name: /一時停止/ }))
    await waitFor(() => expect(send).toHaveBeenCalledWith(2, { cmd: 'pause' }, undefined))
  })

  it('shows_the_last_result_for_the_target_vehicle_from_the_persisted_log', () => {
    const e = (id: number, sysid: number, text: string, severity: LogEntry['severity'], source: LogEntry['source'] = 'command'): LogEntry => ({ id, ts: new Date(2026, 9, 19, 10, 0, id).getTime(), sysid, source, severity, text, ackable: false, acked_by: null, acked_at: null })
    setup(v(1, true), [e(9, 1, 'PreArm: GPS', 'error', 'vehicle'), e(8, 2, 'rtl timeout', 'error'), e(5, 1, 'pause', 'ok')])
    expect(within(panel()).getByTestId('cmd-last')).toHaveTextContent('10:00:05 一時停止 成功')
  })
  it('the_pressed_button_shows_sending_then_the_result', async () => {
    const send = vi.fn(async () => ({ id: 7 }))
    const props = { dict: t('ja'), onClose: vi.fn(), onOpenGuided: vi.fn(), deps: { send, confirm: vi.fn() } as unknown as RunnerDeps, onError: vi.fn() }
    const view = render(<Harness vehicle={v(1, true)} entries={[]} {...props} />)
    const button = () => within(panel()).getByRole('button', { name: /一時停止/ })
    fireEvent.click(button())
    await waitFor(() => expect(send).toHaveBeenCalled())
    expect(button().className).toContain('sending')
    const ok: LogEntry = { id: 9, ts: Date.now(), sysid: 1, source: 'command', severity: 'ok', text: 'pause', ackable: false, acked_by: null, acked_at: null }
    view.rerender(<Harness vehicle={v(1, true)} entries={[ok]} {...props} />)
    await waitFor(() => expect(button().className).toContain('ok'))
    view.rerender(<Harness vehicle={v(2, true)} entries={[ok]} {...props} />)
    expect(button().className).not.toContain('ok')
  })

  it('the_vehicle_name_flashes_when_the_target_changes', () => {
    const { rerender } = setup(v(1, true))
    const before = within(panel()).getByText('UAV-01')
    expect(before.className).toContain('target-flash')
    rerender(v(2, true))
    const after = within(panel()).getByText('UAV-02')
    expect(after.className).toContain('target-flash')
    expect(after).not.toBe(before)
  })
})
