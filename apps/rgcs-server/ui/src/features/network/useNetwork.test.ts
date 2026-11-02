import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NetworkTopology } from '../../shared/api/types'
import { topology } from './fixture'

const fetchNetwork = vi.fn<() => Promise<NetworkTopology>>()
vi.mock('./api', () => ({ fetchNetwork: () => fetchNetwork() }))

const { useNetwork } = await import('./useNetwork')

describe('useNetwork', () => {
  beforeEach(() => {
    fetchNetwork.mockReset()
  })

  it('uses the fetched topology, then newer ws frames, never a stale one', async () => {
    fetchNetwork.mockResolvedValue(topology(1000))
    const { result, rerender } = renderHook(({ ws }: { ws: NetworkTopology | null }) => useNetwork(ws), { initialProps: { ws: null as NetworkTopology | null } })
    await waitFor(() => expect(result.current.topology?.at_unix_ms).toBe(1000))
    expect(fetchNetwork).toHaveBeenCalledTimes(1)
    rerender({ ws: topology(2000) })
    expect(result.current.topology?.at_unix_ms).toBe(2000)
    rerender({ ws: topology(500) })
    expect(result.current.topology?.at_unix_ms).toBe(2000)
    expect(result.current.error).toBeNull()
  })

  it('a ws frame newer than a late fetch wins', async () => {
    let resolve: (t: NetworkTopology) => void = () => {}
    fetchNetwork.mockReturnValue(new Promise((r) => (resolve = r)))
    const { result } = renderHook(() => useNetwork(topology(3000)))
    expect(result.current.topology?.at_unix_ms).toBe(3000)
    resolve(topology(1000))
    await waitFor(() => expect(fetchNetwork).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(result.current.topology?.at_unix_ms).toBe(3000)
  })

  it('a failed fetch reports the netLoadFailed key', async () => {
    fetchNetwork.mockImplementation(() => Promise.reject(new Error('down')))
    const { result } = renderHook(() => useNetwork(null))
    await waitFor(() => expect(result.current.error).toBe('netLoadFailed'))
    expect(result.current.topology).toBeNull()
  })
})
