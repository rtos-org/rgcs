import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { FleetConfirm } from './FleetConfirm'

const v = (sysid: number) => ({ sysid, name: `UAV-0${sysid}`, link: 'ok' }) as VehicleState

describe('FleetConfirm', () => {
  it('lists the targets, runs on all of them and reports each result', async () => {
    const send = vi.fn(async (sysid: number) => {
      if (sysid === 2) throw new Error('busy')
      return { id: sysid }
    })
    const onResult = vi.fn()
    render(<FleetConfirm command={{ cmd: 'pause' }} targets={[v(1), v(2)]} dict={t('ja')} onClose={() => {}} onResult={onResult} deps={{ confirm: vi.fn(), send }} />)
    const dialog = screen.getByRole('dialog', { name: '全機 一時停止' })
    expect(within(dialog).getByText('UAV-01')).toBeInTheDocument()
    expect(within(dialog).getByText('UAV-02')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '実行' }))
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2))
    expect(onResult).toHaveBeenCalledWith(2, false, 'busy')
    expect(within(dialog).getByTestId('fleet-1').className).toContain('ok')
    expect(within(dialog).getByTestId('fleet-2').className).toContain('fail')
    expect(within(dialog).getByRole('button', { name: '閉じる' })).toBeInTheDocument()
  })
  it('says who is targeted and lists the skipped vehicles with the reason', () => {
    const skipped = [{ vehicle: v(2), reason: 'disarmed' as const }, { vehicle: v(3), reason: 'lost' as const }]
    render(<FleetConfirm command={{ cmd: 'rtl' }} targets={[v(1)]} skipped={skipped} dict={t('ja')} onClose={() => {}} onResult={() => {}} deps={{ confirm: vi.fn(), send: vi.fn() }} />)
    const dialog = screen.getByRole('dialog', { name: '全機 帰還' })
    expect(within(dialog).getByTestId('fleet-scope')).toHaveTextContent('対象: アーム中の 1 機 (2 機は対象外)')
    expect(within(dialog).getByTestId('fleet-skip-2')).toHaveTextContent('UAV-02未アーム')
    expect(within(dialog).getByTestId('fleet-skip-3')).toHaveTextContent('UAV-03通信断')
  })
  it('with nothing armed the run is disabled and says so', () => {
    render(<FleetConfirm command={{ cmd: 'pause' }} targets={[]} skipped={[{ vehicle: v(1), reason: 'disarmed' }]} dict={t('ja')} onClose={() => {}} onResult={() => {}} deps={{ confirm: vi.fn(), send: vi.fn() }} />)
    expect(screen.getByText('アーム中の機体がありません')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '実行' })).toBeDisabled()
  })
  it('escape closes before running', () => {
    const onClose = vi.fn()
    render(<FleetConfirm command={{ cmd: 'rtl' }} targets={[v(1)]} dict={t('ja')} onClose={onClose} onResult={() => {}} deps={{ confirm: vi.fn(), send: vi.fn() }} />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
  it('a vehicle whose request hangs does not hold the others or the screen', async () => {
    const send = vi.fn((sysid: number) => (sysid === 2 ? new Promise<never>(() => {}) : Promise.resolve({ id: sysid })))
    const onClose = vi.fn()
    const onResult = vi.fn()
    render(<FleetConfirm command={{ cmd: 'pause' }} targets={[v(1), v(2)]} dict={t('ja')} onClose={onClose} onResult={onResult} deps={{ confirm: vi.fn(), send }} />)
    fireEvent.click(screen.getByRole('button', { name: '実行' }))
    await waitFor(() => expect(screen.getByTestId('fleet-1').className).toContain('ok'))
    expect(onResult).toHaveBeenCalledWith(1, true, undefined)
    expect(screen.getByTestId('fleet-2').className).toContain('sending')
    const close = screen.getByRole('button', { name: '閉じる' })
    expect(close).toBeEnabled()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
