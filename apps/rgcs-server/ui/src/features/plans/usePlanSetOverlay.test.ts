import { describe, expect, it } from 'vitest'
import { applyOthersMode } from './usePlanSetOverlay'

function fakeMap(ids: readonly string[]) {
  const vis = new Map<string, string>()
  const m = {
    getLayer: (id: string) => (ids.includes(id) ? { id } : undefined),
    setLayoutProperty: (id: string, _k: string, v: string) => vis.set(id, v),
  }
  return { m: m as never, vis }
}

describe('applyOthersMode', () => {
  it('hides the 2D routes in 3D (the 3D lines replace them) and keeps fence / rally draped', () => {
    const { m, vis } = fakeMap(['plans-paths', 'plans-predicted', 'plans-fence', 'plans-rally'])
    applyOthersMode(m, true)
    expect(vis.get('plans-paths')).toBe('none')
    expect(vis.get('plans-predicted')).toBe('none')
    expect(vis.has('plans-fence')).toBe(false)
    expect(vis.has('plans-rally')).toBe(false)
    applyOthersMode(m, false)
    expect(vis.get('plans-paths')).toBe('visible')
    expect(vis.get('plans-predicted')).toBe('visible')
  })
  it('does nothing before the layers exist', () => {
    const { m, vis } = fakeMap([])
    applyOthersMode(m, true)
    expect(vis.size).toBe(0)
  })
})
