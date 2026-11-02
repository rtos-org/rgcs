import { describe, expect, it } from 'vitest'
import { fitView, lodFor, panBy, zoomAt } from './viewport'

describe('viewport', () => {
  it('switches level of detail at 55 % and 28 %', () => {
    expect(lodFor(0.55)).toBe('full')
    expect(lodFor(0.5499)).toBe('compact')
    expect(lodFor(0.28)).toBe('compact')
    expect(lodFor(0.2799)).toBe('site')
  })

  it('clamps zoom to 6–250 %', () => {
    expect(zoomAt({ k: 2.4, tx: 0, ty: 0 }, 1.25, 100, 100).k).toBe(2.5)
    expect(zoomAt({ k: 0.07, tx: 0, ty: 0 }, 0.8, 100, 100).k).toBe(0.06)
  })

  it('keeps the point under the cursor fixed', () => {
    expect(zoomAt({ k: 1, tx: 0, ty: 0 }, 2, 100, 50)).toEqual({ k: 2, tx: -100, ty: -50 })
  })

  it('fits the world with a 3 % margin, centred, never above 120 %', () => {
    const v = fitView(1000, 600, 2000, 800)
    expect(v.k).toBe(0.485)
    expect(v.tx).toBeCloseTo((1000 - 2000 * 0.485) / 2)
    expect(v.ty).toBeCloseTo(Math.max(4, (600 - 800 * 0.485) * 0.2))
    expect(fitView(1000, 600, 100, 100).k).toBeCloseTo(1.2 * 0.97)
  })

  it('pans by a screen delta without touching the zoom', () => {
    expect(panBy({ k: 0.5, tx: 10, ty: 20 }, 5, -5)).toEqual({ k: 0.5, tx: 15, ty: 15 })
  })
})
