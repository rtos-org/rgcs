import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CommandResult, InspectorRow, VehicleCommand, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { RateControls } from './RateControls'

const dict = t('ja')
const rx: InspectorRow = { dir: 'rx', sysid: 1, compid: 1, msg_id: 30, name: 'ATTITUDE', count: 5, rate_hz: 4, age_ms: 100 }
const veh = (link: string, armed = false) => ({ sysid: 1, name: 'UAV-01', link, armed }) as unknown as VehicleState
const fleet = (v: VehicleState | undefined) => new Map(v ? [[1, v]] : [])
const setup = (row: InspectorRow, vehicle: VehicleState | undefined, results: readonly CommandResult[] = []) => {
  const send = vi.fn(async (_sysid: number, _command: VehicleCommand) => ({ id: 7 }))
  const view = render(<RateControls row={row} vehicles={fleet(vehicle)} results={results} dict={dict} send={send} />)
  return Object.assign(send, { view })
}
const params = (send: ReturnType<typeof setup>) => (send.mock.calls[0] as unknown as [number, { args: { mav_cmd: number; params: number[] } }])[1].args
const reply = (id: number, ok = true): CommandResult => ({ id, sysid: 1, cmd: 'other', ok, reason: null, ts: 1 })

describe('RateControls', () => {
  it('sends 511 with the message id and the interval in microseconds', async () => {
    const send = setup(rx, veh('ok'))
    fireEvent.change(screen.getByLabelText('レート'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]?.[0]).toBe(1)
    expect(params(send)).toEqual({ mav_cmd: 511, params: [30, 100000, 0, 0, 0, 0, 0] })
  })
  it('default sends 0 and stop sends -1', async () => {
    const send = setup(rx, veh('ok'))
    fireEvent.click(screen.getByRole('button', { name: '既定に戻す' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(params(send).params[1]).toBe(0)
    send.view.rerender(<RateControls row={rx} vehicles={fleet(veh('ok'))} results={[reply(7)]} dict={dict} send={send} />)
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect((send.mock.calls[1] as unknown as [number, { args: { params: number[] } }])[1].args.params[1]).toBe(-1)
  })
  it('does not send an invalid rate and flags the field', () => {
    const send = setup(rx, veh('ok'))
    const input = screen.getByLabelText('レート')
    fireEvent.change(input, { target: { value: '0' } })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: '設定' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    fireEvent.change(input, { target: { value: '51' } })
    expect(send).not.toHaveBeenCalled()
  })
  it('shows the command result when it arrives', async () => {
    const result: CommandResult = { id: 7, sysid: 1, cmd: 'other', ok: false, reason: 'DENIED', ts: 1 }
    setup(rx, veh('ok'), [result])
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(await screen.findByText(/失敗.*DENIED/)).toBeInTheDocument()
  })
  it('ignores a result for another command id', async () => {
    setup(rx, veh('ok'), [{ ...reply(8, false), reason: 'DENIED' }])
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(await screen.findByText(dict.inspRateSent)).toBeInTheDocument()
    expect(screen.queryByText(/DENIED/)).toBeNull()
  })
  it('hides the controls for tx rows, other components and unknown / lost vehicles', () => {
    for (const [row, v] of [
      [{ ...rx, dir: 'tx' as const, sysid: 255, compid: 190 }, veh('ok')],
      [{ ...rx, compid: 100 }, veh('ok')],
      [rx, undefined],
      [rx, veh('lost')],
    ] as const) {
      const { unmount } = render(<RateControls row={row} vehicles={fleet(v)} results={[]} dict={dict} send={vi.fn()} />)
      expect(screen.queryByRole('button', { name: '設定' })).toBeNull()
      expect(screen.getByTestId('insp-rate-note')).toBeInTheDocument()
      unmount()
    }
  })

  it('never offers rate controls for HEARTBEAT (stopping it would lose the vehicle)', () => {
    const send = setup({ ...rx, msg_id: 0, name: 'HEARTBEAT' }, veh('ok'))
    for (const name of ['設定', '既定に戻す', '停止']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.getByTestId('insp-rate-note')).toHaveTextContent(dict.inspRateNoteHeartbeat)
    expect(send).not.toHaveBeenCalled()
  })

  it('while armed, core telemetry cannot be stopped or slowed below 0.5 Hz', () => {
    const send = setup(rx, veh('ok', true))
    expect(screen.getByRole('button', { name: '停止' })).toBeDisabled()
    expect(screen.getByText(dict.inspRateCoreArmed)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    const input = screen.getByLabelText('レート')
    fireEvent.change(input, { target: { value: '0.2' } })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: '設定' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    expect(send).not.toHaveBeenCalled()
  })

  it('a non-core message can still be stopped while armed', () => {
    setup({ ...rx, msg_id: 253, name: 'STATUSTEXT' }, veh('ok', true))
    expect(screen.getByRole('button', { name: '停止' })).toBeEnabled()
    expect(screen.queryByText(dict.inspRateCoreArmed)).toBeNull()
  })

  it('disables the buttons while a send is in flight (no double send)', async () => {
    let resolve: (q: { id: number }) => void = () => {}
    const send = vi.fn((_s: number, _c: VehicleCommand) => new Promise<{ id: number }>((r) => (resolve = r)))
    const { rerender } = render(<RateControls row={rx} vehicles={fleet(veh('ok'))} results={[]} dict={dict} send={send} />)
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    fireEvent.click(screen.getByRole('button', { name: '既定に戻す' }))
    expect(send).toHaveBeenCalledTimes(1)
    for (const name of ['設定', '既定に戻す', '停止']) expect(screen.getByRole('button', { name })).toBeDisabled()
    await act(async () => resolve({ id: 7 }))
    expect(screen.getByRole('button', { name: '設定' })).toBeDisabled()
    rerender(<RateControls row={rx} vehicles={fleet(veh('ok'))} results={[reply(7)]} dict={dict} send={send} />)
    expect(screen.getByRole('button', { name: '設定' })).toBeEnabled()
  })
})
