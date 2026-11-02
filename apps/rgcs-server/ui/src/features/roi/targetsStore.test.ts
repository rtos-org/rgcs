import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoiTarget } from '../../shared/api/types'

const getRoiTargets = vi.fn<(sysid: number) => Promise<RoiTarget[]>>()
vi.mock('./api', () => ({ getRoiTargets: (sysid: number) => getRoiTargets(sysid) }))
const { createRoiTargetsStore, useRoiTargets, roiTargetsStore } = await import('./targetsStore')

const row: RoiTarget = { id: 'roi_1', name: '送電塔 A', lat: 35.479883, lon: 138.48829, alt_msl: 412 }

describe('roiTargetsStore', () => {
  beforeEach(() => {
    getRoiTargets.mockReset()
  })

  it('load caches per vehicle and notifies subscribers', async () => {
    getRoiTargets.mockResolvedValue([row])
    const store = createRoiTargetsStore()
    const listener = vi.fn()
    store.subscribe(listener)
    await store.load(3)
    expect(store.get(3)).toEqual([row])
    expect(store.get(4)).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('set replaces the cached list without a fetch', () => {
    const store = createRoiTargetsStore()
    store.set(2, [row])
    expect(store.get(2)).toEqual([row])
    expect(getRoiTargets).not.toHaveBeenCalled()
  })

  it('a failed load leaves the cache empty', async () => {
    getRoiTargets.mockRejectedValue(new Error('404'))
    const store = createRoiTargetsStore()
    await store.load(1)
    expect(store.get(1)).toBeUndefined()
  })

  it('useRoiTargets loads on first use and returns [] meanwhile', async () => {
    getRoiTargets.mockResolvedValue([row])
    const { result } = renderHook(({ sysid }: { sysid: number | null }) => useRoiTargets(sysid), { initialProps: { sysid: 7 } })
    expect(result.current).toEqual([])
    await waitFor(() => expect(result.current).toEqual([row]))
    expect(getRoiTargets).toHaveBeenCalledTimes(1)
    act(() => roiTargetsStore.set(7, []))
    expect(result.current).toEqual([])
  })
})
