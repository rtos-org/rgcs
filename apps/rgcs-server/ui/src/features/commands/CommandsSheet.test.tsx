import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { CommandsSheet } from './CommandsSheet'

const v = (armed: boolean): VehicleState => ({
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'LOITER', armed, lat: 0, lon: 0, alt_rel: 0, alt_msl: 0, hdg: null,
  ground_speed: 0, climb: 0, battery: { pct: 50, volt: 22, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 9, hdop: 1 }, warn: false, unread: 0,
})

describe('CommandsSheet', () => {
  it('disables ARM when armed and filters by label', () => {
    render(<CommandsSheet vehicle={v(true)} onPick={() => {}} onOpen={() => {}} onClose={() => {}} dict={t('ja')} />)
    expect(screen.getByRole('button', { name: 'アーム' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'ディスアーム' })).toBeEnabled()
    fireEvent.change(screen.getByPlaceholderText('コマンドを検索'), { target: { value: '帰還' } })
    expect(screen.getByRole('button', { name: '帰還' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'アーム' })).not.toBeInTheDocument()
  })

  it('picks simple and parameterised commands in the serde shape, and opens guided', () => {
    const onPick = vi.fn()
    const onOpen = vi.fn()
    render(<CommandsSheet vehicle={v(false)} onPick={onPick} onOpen={onOpen} onClose={() => {}} dict={t('ja')} />)
    fireEvent.click(screen.getByRole('button', { name: 'アーム' }))
    expect(onPick).toHaveBeenLastCalledWith({ cmd: 'arm' })
    // parameterised commands open their input on the first click and run on the second (or 実行)
    fireEvent.click(screen.getByRole('button', { name: 'モード変更' }))
    fireEvent.change(screen.getByLabelText('モード変更'), { target: { value: 'AUTO' } })
    fireEvent.click(screen.getByRole('button', { name: '実行' }))
    expect(onPick).toHaveBeenLastCalledWith({ cmd: 'set_mode', args: { mode: 'AUTO' } })
    fireEvent.click(screen.getByRole('button', { name: '高度変更' }))
    fireEvent.change(screen.getByLabelText('高度変更'), { target: { value: '55' } })
    fireEvent.click(screen.getByRole('button', { name: '高度変更' }))
    expect(onPick).toHaveBeenLastCalledWith({ cmd: 'change_alt', args: { alt_rel: 55 } })
    fireEvent.click(screen.getByRole('button', { name: 'Guided 移動' }))
    expect(onOpen).toHaveBeenCalledWith('guided')
  })
  it('カメラ・ジンバル opens the camera settings', () => {
    const onOpen = vi.fn()
    render(<CommandsSheet vehicle={v(true)} onPick={() => {}} onOpen={onOpen} onClose={() => {}} dict={t('ja')} />)
    fireEvent.click(screen.getByRole('button', { name: 'カメラ・ジンバル' }))
    expect(onOpen).toHaveBeenCalledWith('camera')
    expect(screen.queryByRole('button', { name: 'その他の対応コマンド' })).toBeNull()
  })

  it('quick mode chips switch mode in one click and mark the current one', () => {
    const onPick = vi.fn()
    render(<CommandsSheet vehicle={v(true)} onPick={onPick} onOpen={() => {}} onClose={() => {}} dict={t('ja')} />)
    const row = screen.getByRole('group', { name: 'クイックモード' })
    const chips = [...row.querySelectorAll('button')].map((b) => b.textContent)
    expect(chips).toEqual(['STABILIZE', 'ALT_HOLD', 'LOITER', 'POSHOLD', 'GUIDED', 'AUTO', 'RTL', 'LAND'])
    expect(screen.getByRole('button', { name: 'LOITER' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'AUTO' }))
    expect(onPick).toHaveBeenLastCalledWith({ cmd: 'set_mode', args: { mode: 'AUTO' } })
  })

  it('a QuadPlane gets its own chips and its mode list (not the copter one)', () => {
    const qp = { ...v(true), kind: 'plane' as const, vtol: true, mode: 'QLOITER' }
    render(<CommandsSheet vehicle={qp} onPick={() => {}} onOpen={() => {}} onClose={() => {}} dict={t('ja')} />)
    const row = screen.getByRole('group', { name: 'クイックモード' })
    expect([...row.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['QHOVER', 'QLOITER', 'QLAND', 'QRTL', 'FBWA', 'LOITER', 'AUTO', 'RTL'])
    expect(screen.getByRole('button', { name: 'QLOITER' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'モード変更' }))
    const options = [...(screen.getByLabelText('モード変更') as HTMLSelectElement).options].map((o) => o.value)
    expect(options).toContain('QHOVER')
    expect(options).not.toContain('ALT_HOLD')
  })

  it('altitude and speed inputs start at the current value and step by 5', () => {
    const onPick = vi.fn()
    render(<CommandsSheet vehicle={{ ...v(true), alt_rel: 29.6, ground_speed: 7.4 }} onPick={onPick} onOpen={() => {}} onClose={() => {}} dict={t('ja')} />)
    fireEvent.click(screen.getByRole('button', { name: '高度変更' }))
    expect(screen.getByLabelText('高度変更')).toHaveValue('30')
    fireEvent.click(screen.getByRole('button', { name: '+5' }))
    expect(screen.getByLabelText('高度変更')).toHaveValue('35')
    fireEvent.click(screen.getByRole('button', { name: '実行' }))
    expect(onPick).toHaveBeenLastCalledWith({ cmd: 'change_alt', args: { alt_rel: 35 } })
    fireEvent.click(screen.getByRole('button', { name: '速度変更' }))
    expect(screen.getByLabelText('速度変更')).toHaveValue('7')
    fireEvent.click(screen.getByRole('button', { name: '-5' }))
    expect(screen.getByLabelText('速度変更')).toHaveValue('2')
  })
  it('takeoff asks for an altitude starting at 30 m on a copter, disabled until armed', () => {
    const onPick = vi.fn()
    const { rerender } = render(<CommandsSheet vehicle={v(false)} onPick={onPick} onOpen={() => {}} onClose={() => {}} dict={t('ja')} />)
    const btn = screen.getByRole('button', { name: '離陸' })
    expect(btn).toBeDisabled()
    // the reason is on screen, not only in a hover title
    expect(screen.getByText('アーム後に使用できます')).toBeInTheDocument()
    rerender(<CommandsSheet vehicle={{ ...v(true), alt_rel: 12 }} onPick={onPick} onOpen={() => {}} onClose={() => {}} dict={t('ja')} />)
    fireEvent.click(screen.getByRole('button', { name: '離陸' }))
    expect(screen.getByLabelText('離陸')).toHaveValue('30')
    fireEvent.click(screen.getByRole('button', { name: '+5' }))
    fireEvent.click(screen.getByRole('button', { name: '実行' }))
    expect(onPick).toHaveBeenLastCalledWith({ cmd: 'takeoff', args: { alt_rel: 35 } })
  })

  it('a fixed wing takes off to TKOFF_ALT without an altitude input; a rover has no takeoff', () => {
    const onPick = vi.fn()
    const plane = { ...v(true), kind: 'plane' as const, mode: 'FBWA' }
    const { unmount } = render(<CommandsSheet vehicle={plane} onPick={onPick} onOpen={() => {}} onClose={() => {}} dict={t('ja')} />)
    fireEvent.click(screen.getByRole('button', { name: '離陸' }))
    expect(screen.queryByLabelText('離陸')).toBeNull()
    expect(screen.getByText('TKOFF_ALT まで上昇')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '実行' }))
    expect(onPick).toHaveBeenLastCalledWith({ cmd: 'takeoff', args: { alt_rel: 30 } })
    unmount()
    render(<CommandsSheet vehicle={{ ...v(true), kind: 'rover' }} onPick={onPick} onOpen={() => {}} onClose={() => {}} dict={t('ja')} />)
    expect(screen.queryByRole('button', { name: '離陸' })).toBeNull()
  })

  it('a rover gets no land or altitude change, and its first group is 走行', () => {
    render(<CommandsSheet vehicle={{ ...v(true), kind: 'rover', mode: 'AUTO' }} onPick={() => {}} onOpen={() => {}} onClose={() => {}} dict={t('ja')} />)
    expect(screen.queryByRole('button', { name: '着陸' })).toBeNull()
    expect(screen.queryByRole('button', { name: '高度変更' })).toBeNull()
    const titles = [...document.querySelectorAll('.cmd-group-title')].map((e) => e.textContent)
    expect(titles[0]).toBe('走行')
    expect(titles).not.toContain('飛行')
  })

  it('shows why the vehicle refused to arm under ARM while disarmed', () => {
    const { rerender } = render(<CommandsSheet vehicle={v(false)} prearm={['PreArm: Compass not calibrated']} onPick={() => {}} onOpen={() => {}} onClose={() => {}} dict={t('ja')} />)
    expect(screen.getByTestId('prearm')).toHaveTextContent('PreArm: Compass not calibrated')
    rerender(<CommandsSheet vehicle={v(true)} prearm={['PreArm: Compass not calibrated']} onPick={() => {}} onOpen={() => {}} onClose={() => {}} dict={t('ja')} />)
    expect(screen.queryByTestId('prearm')).toBeNull()
  })
})
