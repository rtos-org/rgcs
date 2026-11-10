import { afterEach, describe, expect, it, vi } from 'vitest'
import { groundElevation } from './elevation'

const flat = (h: number) => new Float32Array(256 * 256).fill(h)

describe('groundElevation', () => {
  afterEach(() => vi.useRealTimers())

  it('resolves to the sampled value once the tile arrives', async () => {
    const load = vi.fn((_url: string) => new Promise<Float32Array | null>((res) => setTimeout(() => res(flat(388)), 5)))
    await expect(groundElevation('https://t/{z}/{x}/{y}.png', 138.46829, 35.469883, { load })).resolves.toBeCloseTo(388)
    expect(load).toHaveBeenCalledTimes(1)
    expect(load.mock.calls[0]?.[0]).toMatch(/^https:\/\/t\/13\/\d+\/\d+\.png$/)
  })

  it('uses the requested DEM encoding for the sample', async () => {
    const load = vi.fn(async () => flat(1505.8))
    await expect(groundElevation('https://t/{z}/{x}/{y}.png', 137.6385, 36.2509, { load, terrainEncoding: 'mapbox' })).resolves.toBeCloseTo(1505.8)
    expect(load).toHaveBeenCalledWith(expect.any(String), 'mapbox')
  })

  it('resolves null after the timeout when the tile does not load', async () => {
    vi.useFakeTimers()
    const p = groundElevation('https://t/{z}/{x}/{y}.png', 138.46829, 35.469883, { timeoutMs: 3000, load: () => Promise.resolve(null) })
    await vi.advanceTimersByTimeAsync(3000)
    await expect(p).resolves.toBeNull()
  })

  it('resolves null at once without a tiles url', async () => {
    const load = vi.fn((_url: string) => Promise.resolve(null))
    await expect(groundElevation(null, 138.46829, 35.469883, { load })).resolves.toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})
