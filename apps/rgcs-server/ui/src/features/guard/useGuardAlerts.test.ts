import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GuardAlert, ServerMessage } from '../../shared/api/types'
import type { FrameSource } from '../vehicles/store'
import { guardAlert } from '../ai/fixtures'
import { useGuardAlerts } from './useGuardAlerts'

function frames() {
  const listeners = new Set<(m: ServerMessage) => void>()
  const source: FrameSource = {
    onFrame: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
  const emit = (m: ServerMessage) => act(() => listeners.forEach((l) => l(m)))
  return { source, emit, listeners }
}

describe('useGuardAlerts', () => {
  it('loads the active alerts for a fresh client', async () => {
    const f = frames()
    const load = vi.fn(async (): Promise<GuardAlert[]> => [guardAlert()])
    const { result } = renderHook(() => useGuardAlerts(f.source, load))
    await waitFor(() => expect(result.current.alerts.size).toBe(1))
    expect([...result.current.active]).toEqual([3])
  })

  it('applies guard_alert frames and drops cleared ones', async () => {
    const f = frames()
    const { result } = renderHook(() => useGuardAlerts(f.source, async () => []))
    f.emit({ t: 'guard_alert', alert: guardAlert({ phase: 'countdown', deadline_ms: 6_000, ts: 1_000 }) })
    expect(result.current.alerts.get('g-1')?.phase).toBe('countdown')
    f.emit({ t: 'guard_alert', alert: guardAlert({ phase: 'cleared' }) })
    expect(result.current.alerts.size).toBe(0)
  })

  it('reloads after a reconnect snapshot and ignores load failures', async () => {
    const f = frames()
    const load = vi.fn(async (): Promise<GuardAlert[]> => {
      throw new Error('offline')
    })
    const { result } = renderHook(() => useGuardAlerts(f.source, load))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    load.mockResolvedValueOnce([guardAlert({ id: 'g-9', sysid: 9 })])
    f.emit({ t: 'snapshot', vehicles: [], cameras: [], video_sources: [] } as unknown as ServerMessage)
    await waitFor(() => expect(result.current.alerts.has('g-9')).toBe(true))
  })

  it('unsubscribes on unmount', () => {
    const f = frames()
    const { unmount } = renderHook(() => useGuardAlerts(f.source, async () => []))
    expect(f.listeners.size).toBe(1)
    unmount()
    expect(f.listeners.size).toBe(0)
  })
})
