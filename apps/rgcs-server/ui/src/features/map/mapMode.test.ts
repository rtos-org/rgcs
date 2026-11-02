import { describe, expect, it, vi } from 'vitest'
import { applyMapMode, readMapMode, saveMapMode, SKY } from './mapMode'

function host() {
  const calls: string[] = []
  const vis = new Map<string, string>()
  return {
    calls,
    vis,
    stop: vi.fn(() => calls.push('stop')),
    setTerrain: vi.fn((t: unknown) => calls.push(`terrain:${t === null ? 'off' : 'on'}`)),
    setSky: vi.fn(),
    easeTo: vi.fn((o: { pitch: number }) => calls.push(`ease:${o.pitch}`)),
    getLayer: (id: string) => (['a', 'b'].includes(id) ? { id } : undefined),
    getSource: (id: string) => (id === 'dem' ? {} : undefined),
    setLayoutProperty: (id: string, _k: string, v: string) => vis.set(id, v),
  }
}

describe('applyMapMode', () => {
  it('stops the camera and sets the terrain BEFORE easing (MapLibre crashes otherwise)', () => {
    const m = host()
    applyMapMode(m, '3d', { only3d: ['a'], only2d: ['b'] })
    expect(m.calls).toEqual(['stop', 'terrain:on', 'ease:60'])
    expect(m.setTerrain).toHaveBeenCalledWith({ source: 'dem', exaggeration: 1 })
    expect(m.easeTo).toHaveBeenCalledWith({ pitch: 60, bearing: -25, duration: 900, freezeElevation: true })
    expect(m.vis.get('a')).toBe('visible')
    expect(m.vis.get('b')).toBe('none')
  })
  it('paints a sky above the horizon in 3D and clears it in 2D', () => {
    const m = host()
    applyMapMode(m, '3d', { only3d: [], only2d: [] })
    expect(m.setSky).toHaveBeenLastCalledWith(SKY)
    applyMapMode(m, '2d', { only3d: [], only2d: [] })
    expect(m.setSky).toHaveBeenLastCalledWith(undefined)
  })
  it('flattens the map in 2D', () => {
    const m = host()
    applyMapMode(m, '2d', { only3d: ['a'], only2d: ['b'] })
    expect(m.calls).toEqual(['stop', 'terrain:off', 'ease:0'])
    expect(m.easeTo).toHaveBeenCalledWith({ pitch: 0, bearing: 0, duration: 900, freezeElevation: true })
    expect(m.vis.get('a')).toBe('none')
  })
  it('stays 2D without a terrain source', () => {
    const m = { ...host(), getSource: () => undefined }
    applyMapMode(m, '3d', { only3d: [], only2d: [] })
    expect(m.setTerrain).toHaveBeenCalledWith(null)
  })
  it('can skip the camera animation (initial load)', () => {
    const m = host()
    applyMapMode(m, '3d', { only3d: [], only2d: [] }, false)
    expect(m.easeTo).not.toHaveBeenCalled()
  })
})

describe('map mode choice', () => {
  it('defaults to 2D and remembers the pick', () => {
    localStorage.removeItem('rgcs.mapMode')
    expect(readMapMode()).toBe('2d')
    saveMapMode('3d')
    expect(localStorage.getItem('rgcs.mapMode')).toBe('3d')
    expect(readMapMode()).toBe('3d')
    localStorage.setItem('rgcs.mapMode', 'nonsense')
    expect(readMapMode()).toBe('2d')
  })
})
