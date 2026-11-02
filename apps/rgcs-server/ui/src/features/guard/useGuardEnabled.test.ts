import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GuardSettings } from '../../shared/api/types'
import { useGuardEnabled } from './useGuardEnabled'

const settings = (enabled: boolean) => ({ enabled }) as GuardSettings

describe('useGuardEnabled', () => {
  it('reads the setting and re-reads when the key changes', async () => {
    const load = vi.fn(async () => settings(false))
    const { result, rerender } = renderHook(({ k }) => useGuardEnabled(k, load), { initialProps: { k: 'a' } })
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    expect(result.current).toBe(false)
    load.mockResolvedValueOnce(settings(true))
    rerender({ k: 'b' })
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('is false when the read fails', async () => {
    const load = vi.fn(async (): Promise<GuardSettings> => {
      throw new Error('offline')
    })
    const { result } = renderHook(() => useGuardEnabled('a', load))
    await waitFor(() => expect(load).toHaveBeenCalled())
    expect(result.current).toBe(false)
  })
})
