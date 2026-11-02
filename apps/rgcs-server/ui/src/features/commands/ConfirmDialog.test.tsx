import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { VehicleState } from '../../shared/api/types'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  it('requests a token then sends the command with it, reporting the result', async () => {
    const confirm = vi.fn().mockResolvedValue({ confirm_token: 'tok', expires_in: 30 })
    const send = vi.fn().mockResolvedValue({ id: 9 })
    const onDone = vi.fn()
    render(
      <ConfirmDialog sysid={1} command={{ cmd: 'arm' }} vehicleName="UAV-01" onCancel={() => {}} onDone={onDone} dict={t('ja')} deps={{ confirm, send }} />,
    )
    expect(screen.getByRole('dialog')).toHaveTextContent('アーム')
    expect(screen.getByRole('dialog')).toHaveTextContent('UAV-01')
    const run = screen.getByRole('button', { name: '実行' })
    expect(run).toHaveClass('btn-danger')
    fireEvent.click(run)
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ kind: 'queued', id: 9 }))
    expect(confirm).toHaveBeenCalledWith(1, 'arm')
    expect(send).toHaveBeenCalledWith(1, { cmd: 'arm' }, 'tok')
  })

  it('shows the takeoff altitude, or TKOFF_ALT for a fixed wing', () => {
    const base: VehicleState = {
      sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'LOITER', armed: true, lat: 0, lon: 0, alt_rel: 0, alt_msl: 0, hdg: null,
      ground_speed: 0, climb: 0, battery: { pct: 50, volt: 22, current: null }, link: 'ok', last_rx_ms: 0,
      gps: { fix: 3, sats: 9, hdop: 1 }, warn: false, unread: 0,
    }
    const cmd = { cmd: 'takeoff', args: { alt_rel: 25 } } as const
    const { unmount } = render(<ConfirmDialog sysid={1} command={cmd} vehicleName="UAV-01" vehicle={base} onCancel={() => {}} onDone={() => {}} dict={t('ja')} />)
    expect(screen.getByRole('dialog')).toHaveTextContent('離陸 → 25 m')
    unmount()
    render(<ConfirmDialog sysid={1} command={cmd} vehicleName="FW-1" vehicle={{ ...base, kind: 'plane' }} onCancel={() => {}} onDone={() => {}} dict={t('en')} />)
    expect(screen.getByRole('dialog')).toHaveTextContent('Takeoff → TKOFF_ALT')
  })

  it('uses the primary button for non-destructive commands and shows the carried message', () => {
    render(
      <ConfirmDialog
        sysid={1}
        command={{ cmd: 'set_mode', args: { mode: 'AUTO' } }}
        vehicleName="UAV-01"
        message="confirm token expired"
        onCancel={() => {}}
        onDone={() => {}}
        dict={t('ja')}
      />,
    )
    expect(screen.getByRole('button', { name: '実行' })).toHaveClass('btn-primary')
    expect(screen.getByText('confirm token expired')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveTextContent('AUTO')
  })

  it('cancel calls onCancel and a failed token request reports an error', async () => {
    const onCancel = vi.fn()
    const onDone = vi.fn()
    const confirm = vi.fn().mockRejectedValue(new Error('offline'))
    render(
      <ConfirmDialog sysid={1} command={{ cmd: 'rtl' }} vehicleName="UAV-01" onCancel={onCancel} onDone={onDone} dict={t('ja')} deps={{ confirm, send: vi.fn() }} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '実行' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ kind: 'error', code: 'unknown', message: 'offline' }))
  })
  const veh = (over: Partial<VehicleState> = {}): VehicleState => ({
    sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'LOITER', armed: true, lat: 35.480883, lon: 138.48029, alt_rel: 29.6, alt_msl: 0, hdg: null,
    ground_speed: 0, climb: 0, battery: { pct: 50, volt: 22, current: null }, link: 'ok', last_rx_ms: 0,
    gps: { fix: 3, sats: 10, hdop: 1 }, warn: false, unread: 0, home: { lat: 35.479883, lon: 138.48029, alt: 400 }, ...over,
  })
  const deps = () => ({ confirm: vi.fn().mockResolvedValue({ confirm_token: 'tok', expires_in: 30 }), send: vi.fn().mockResolvedValue({ id: 9 }) })
  const show = (cmd: 'rtl' | 'disarm', d = deps(), onCancel = vi.fn(), v = veh()) => {
    render(<ConfirmDialog sysid={1} command={{ cmd }} vehicleName="UAV-01" vehicle={v} onCancel={onCancel} onDone={() => {}} dict={t('ja')} deps={d} />)
    return { d, onCancel }
  }

  it('shows the target\'s mode, altitude, battery and distance from home', () => {
    show('rtl')
    const ctx = screen.getByTestId('confirm-ctx')
    expect(ctx).toHaveTextContent('LOITER')
    expect(ctx).toHaveTextContent('30 m')
    expect(ctx).toHaveTextContent('50%')
    expect(ctx).toHaveTextContent('ホームから 111 m')
  })

  it('a rover\'s context has no altitude', () => {
    render(<ConfirmDialog sysid={1} command={{ cmd: 'rtl' }} vehicleName="UAV-04" vehicle={veh({ kind: 'rover' })} onCancel={() => {}} onDone={() => {}} dict={t('ja')} deps={{ confirm: vi.fn(), send: vi.fn() }} />)
    const ctx = screen.getByTestId('confirm-ctx')
    expect(ctx).not.toHaveTextContent('高度')
    expect(ctx).toHaveTextContent('ホームから 111 m')
  })

  it('escape cancels and enter executes', async () => {
    const { d, onCancel } = show('rtl')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
    fireEvent.keyDown(document.body, { key: 'Enter' })
    await waitFor(() => expect(d.confirm).toHaveBeenCalledWith(1, 'rtl'))
  })

  it('enter typed into a field outside the dialog does not execute', () => {
    const outside = document.createElement('input')
    document.body.append(outside)
    outside.focus()
    const { d } = show('rtl')
    fireEvent.keyDown(outside, { key: 'Enter' })
    expect(d.confirm).not.toHaveBeenCalled()
    outside.remove()
  })

  it('disarming in flight needs a 1.5 s hold', async () => {
    vi.useFakeTimers()
    try {
      const { d } = show('disarm')
      const run = screen.getByRole('button', { name: /長押しで実行/ })
      fireEvent.click(run)
      fireEvent.keyDown(document.body, { key: 'Enter' })
      fireEvent.pointerDown(run)
      act(() => vi.advanceTimersByTime(1000))
      fireEvent.pointerUp(run)
      act(() => vi.advanceTimersByTime(1000))
      expect(d.confirm).not.toHaveBeenCalled()
      fireEvent.pointerDown(run)
      act(() => vi.advanceTimersByTime(1500))
      expect(d.confirm).toHaveBeenCalledWith(1, 'disarm')
    } finally {
      vi.useRealTimers()
    }
  })

  it('any disarm of an armed vehicle needs the hold (alt_rel can read ≤ 1 m in the air)', () => {
    show('disarm', deps(), vi.fn(), veh({ alt_rel: -3 }))
    expect(screen.getByRole('button', { name: /長押しで実行/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '実行' })).toBeNull()
  })

  it('an auto-repeated Enter (the key that opened the dialog, still held) does not execute', () => {
    const { d } = show('rtl')
    fireEvent.keyDown(document.body, { key: 'Enter', repeat: true })
    expect(d.confirm).not.toHaveBeenCalled()
  })
  it('shows the AI note and sends the proposal id with the token', async () => {
    const confirm = vi.fn().mockResolvedValue({ confirm_token: 'tok', expires_in: 30 })
    const send = vi.fn().mockResolvedValue({ id: 9 })
    const onDone = vi.fn()
    render(
      <ConfirmDialog sysid={1} command={{ cmd: 'arm' }} vehicleName="UAV-01" aiProposalId="p-1" note="hold short" onCancel={() => {}} onDone={onDone} dict={t('ja')} deps={{ confirm, send }} />,
    )
    const note = screen.getByTestId('confirm-ai-note')
    expect(note).toHaveClass('t3')
    expect(note).toHaveTextContent('AI の提案: hold short')
    expect(note.querySelector('.lucide-sparkles')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '実行' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ kind: 'queued', id: 9 }))
    expect(send).toHaveBeenCalledWith(1, { cmd: 'arm' }, 'tok', 'p-1')
  })
})
