import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { GuardAlert } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { guardAlert } from '../ai/fixtures'
import { applyGuardAlert, type AlertMap } from './alerts'
import { GuardBanner } from './GuardBanner'
import type { Tone } from './sound'

const dict = t('ja')
const NOW = 100_000

function mapOf(...alerts: GuardAlert[]): AlertMap {
  return alerts.reduce<AlertMap>((m, a, i) => applyGuardAlert(m, a, NOW + i), new Map())
}

function tone(ready = true): Tone & { play: Mock<() => void> } {
  return { play: vi.fn<() => void>(), ready: () => ready }
}

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) } as unknown as Storage
}

const countdown = guardAlert({ phase: 'countdown', action_mode: 'ALT_HOLD', ts: NOW, deadline_ms: NOW + 5_000, sound: true })

function show(alerts: AlertMap, over: Partial<Parameters<typeof GuardBanner>[0]> = {}) {
  const props = { alerts, now: NOW, dict, tone: tone(), onCancel: vi.fn(), onFocus: vi.fn(), ...over }
  return { ...render(<GuardBanner {...props} />), props }
}

describe('GuardBanner', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders nothing without alerts', () => {
    const { container } = show(new Map())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the countdown with a large 取り消し that cancels once', () => {
    const { container, props, rerender } = show(mapOf(countdown))
    const banner = container.querySelector('div.guard-banner.danger') as HTMLElement
    expect(banner).not.toBeNull()
    expect(banner.querySelector('svg.lucide-shield-alert')).not.toBeNull()
    expect(banner.querySelector('.guard-headline')).toHaveTextContent('UAV-03 旋回が不安定です (トイレットボウル) — 手動で引き継いでください')
    expect(banner).toHaveTextContent('5 秒後に ALT_HOLD へ切り替えます')
    const cancel = screen.getByRole('button', { name: '取り消し' })
    expect(cancel).toHaveClass('btn', 'btn-danger')
    fireEvent.click(cancel)
    fireEvent.click(cancel)
    expect(props.onCancel).toHaveBeenCalledTimes(1)
    expect(props.onCancel).toHaveBeenCalledWith('g-1')
    expect(cancel).toBeDisabled()
    rerender(<GuardBanner {...props} now={NOW + 2_100} />)
    expect(banner).toHaveTextContent('3 秒後に ALT_HOLD へ切り替えます')
  })

  it('re-enables 取り消し when the cancel request fails', async () => {
    const onCancel = vi.fn(() => Promise.reject(new Error('offline')))
    show(mapOf(countdown), { onCancel })
    const cancel = screen.getByRole('button', { name: '取り消し' })
    await act(async () => {
      fireEvent.click(cancel)
    })
    expect(cancel).not.toBeDisabled()
  })

  it('keeps 取り消し while a due switch waits for the signs to continue', () => {
    const { container, props } = show(mapOf(guardAlert({ phase: 'due', action_mode: 'ALT_HOLD', sound: false })))
    const banner = container.querySelector('div.guard-banner') as HTMLElement
    expect(banner).toHaveClass('danger')
    expect(banner).toHaveTextContent('兆候が続けば ALT_HOLD へ切り替えます')
    fireEvent.click(screen.getByRole('button', { name: '取り消し' }))
    expect(props.onCancel).toHaveBeenCalledWith('g-1')
  })

  it('names QHOVER in the due line for a QuadPlane', () => {
    show(mapOf(guardAlert({ phase: 'due', action_mode: 'QHOVER', sound: false })), { dict: t('en') })
    expect(screen.getByText('Switching to QHOVER if the signs continue')).toBeInTheDocument()
  })

  it('shows the executed line without 取り消し', () => {
    show(mapOf(guardAlert({ phase: 'executed', action_mode: 'ALT_HOLD', sound: false })))
    expect(screen.getByText('ALT_HOLD に切り替えました — 風で流れます。手動で引き継いでください')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取り消し' })).toBeNull()
  })

  it('adds the RC-stale and Kp lines', () => {
    show(mapOf(guardAlert({ rc_stale: true, kp_raised: true })))
    expect(screen.getByText('RC 未受信 — GCS 操作で引き継ぎ')).toBeInTheDocument()
    expect(screen.getByText('宇宙天気(Kp)により感度を上げています')).toBeInTheDocument()
  })

  it('shows unanswered', () => {
    show(mapOf(guardAlert({ phase: 'unanswered' })))
    expect(screen.getByText('引き継ぎが確認できません — AI はこれ以上操作しません')).toBeInTheDocument()
  })

  it('shows a neutral banner once taken over', () => {
    const { container } = show(mapOf(guardAlert({ phase: 'taken_over', sound: false })))
    const banner = container.querySelector('div.guard-banner') as HTMLElement
    expect(banner).toHaveClass('neutral')
    expect(banner).not.toHaveClass('danger')
    expect(banner).toHaveTextContent('引き継ぎ済み')
  })

  it('shows a mode change the AI did not make as a warning, not as taken over', () => {
    const a = guardAlert({ phase: 'taken_over', taken_over_by: 'mode_change', vehicle_mode: 'LAND', sound: false })
    const { container } = show(mapOf(a))
    const banner = container.querySelector('div.guard-banner') as HTMLElement
    expect(banner).toHaveClass('warn')
    expect(banner).not.toHaveClass('neutral')
    expect(banner).toHaveTextContent('モードが LAND に変わりました — AI はこれ以上操作しません')
    expect(banner).not.toHaveTextContent('引き継ぎ済み')
  })

  it('plays the tone at once and every 10 s, and mute stops it across re-renders', () => {
    vi.useFakeTimers()
    const tn = tone()
    const { props, rerender } = show(mapOf(countdown), { tone: tn })
    expect(tn.play).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(10_000))
    expect(tn.play).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: '警告音を消す' }))
    act(() => vi.advanceTimersByTime(30_000))
    expect(tn.play).toHaveBeenCalledTimes(2)
    rerender(<GuardBanner {...props} tone={tn} now={NOW + 1_000} />)
    expect(screen.getByRole('button', { name: '警告音を鳴らす' })).toHaveAttribute('aria-pressed', 'true')
    act(() => vi.advanceTimersByTime(30_000))
    expect(tn.play).toHaveBeenCalledTimes(2)
  })

  it('remembers the mute in this browser', () => {
    const first = show(mapOf(countdown))
    fireEvent.click(screen.getByRole('button', { name: '警告音を消す' }))
    first.unmount()
    const tn = tone()
    show(mapOf(countdown), { tone: tn })
    expect(screen.getByRole('button', { name: '警告音を鳴らす' })).toBeInTheDocument()
    expect(tn.play).not.toHaveBeenCalled()
  })

  it('still renders when localStorage throws', () => {
    const boom = () => {
      throw new Error('denied')
    }
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom })
    show(mapOf(countdown))
    fireEvent.click(screen.getByRole('button', { name: '警告音を消す' }))
    expect(screen.getByRole('button', { name: '警告音を鳴らす' })).toBeInTheDocument()
  })

  it('does not play for an alert without sound', () => {
    const tn = tone()
    show(mapOf(guardAlert({ phase: 'executed', action_mode: 'ALT_HOLD', sound: false })), { tone: tn })
    expect(tn.play).not.toHaveBeenCalled()
  })

  it('asks for a click while audio is still locked', () => {
    show(mapOf(countdown), { tone: tone(false) })
    expect(screen.getByText('音を有効にするには画面をクリック')).toBeInTheDocument()
  })

  it('focuses the vehicle from its name', () => {
    const { props } = show(mapOf(countdown))
    fireEvent.click(screen.getByRole('button', { name: 'UAV-03' }))
    expect(props.onFocus).toHaveBeenCalledWith(3)
  })

  it('stacks alerts of two vehicles, newest first', () => {
    const { container } = show(mapOf(guardAlert({ id: 'g-1', sysid: 3 }), guardAlert({ id: 'g-2', sysid: 4, vehicle_name: 'UAV-04' })))
    const rows = [...container.querySelectorAll('div.guard-banner')]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('UAV-04')
    expect(rows[1]).toHaveTextContent('UAV-03')
  })
})
