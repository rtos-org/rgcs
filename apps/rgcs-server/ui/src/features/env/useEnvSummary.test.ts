import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EnvSummary, ServerMessage } from '../../shared/api/types'
import type { FrameSource } from '../vehicles/store'
import { useEnvSummary } from './useEnvSummary'

const S = (ts: number): EnvSummary => ({ cell: null, factors: [], missing: [], unavailable: false, notes: [], ts })

function frames() {
  const listeners = new Set<(m: ServerMessage) => void>()
  const source: FrameSource = {
    onFrame: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
  return { source, emit: (m: ServerMessage) => act(() => listeners.forEach((l) => l(m))) }
}

describe('useEnvSummary', () => {
  it('loads once, then follows env_summary frames', async () => {
    const f = frames()
    const load = vi.fn(async () => S(1))
    const { result } = renderHook(() => useEnvSummary(f.source, load))
    await waitFor(() => expect(result.current?.ts).toBe(1))
    f.emit({ t: 'env_summary', summary: S(2) })
    expect(result.current?.ts).toBe(2)
  })

  it('stays null when the load fails', async () => {
    const f = frames()
    const load = vi.fn(async (): Promise<EnvSummary> => {
      throw new Error('offline')
    })
    const { result } = renderHook(() => useEnvSummary(f.source, load))
    await waitFor(() => expect(load).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })
})
