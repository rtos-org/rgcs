import { describe, expect, it } from 'vitest'
import { coverRect, detectionToDisplay, pointToDisplay, previewBox, rectToDisplay, toNormalized } from './geometry'

describe('cover geometry', () => {
  it('coverRect crops the long side and centres the picture', () => {
    expect(coverRect(1000, 400, 1920, 1080)).toEqual({ x: 0, y: -81.25, w: 1000, h: 562.5 })
    const r = coverRect(640, 480, 1280, 720)!
    expect(r.h).toBe(480)
    expect(r.y).toBe(0)
    expect(r.w).toBeCloseTo(853.33, 2)
    expect(r.x).toBeCloseTo(-106.67, 2)
  })

  it('coverRect is null while any size is unknown', () => {
    expect(coverRect(640, 480, 0, 0)).toBeNull()
    expect(coverRect(0, 480, 1280, 720)).toBeNull()
  })

  it('toNormalized maps element points into the picture', () => {
    expect(toNormalized(320, 240, coverRect(640, 480, 1280, 720))).toEqual({ nx: 0.5, ny: 0.5 })
    expect(toNormalized(10, 10, null)).toBeNull()
    expect(toNormalized(-500, 10, { x: 0, y: 0, w: 100, h: 100 })).toBeNull()
  })

  it('previewBox mirrors the server click box (half-size display of 1920 × 1080)', () => {
    const r = { x: 0, y: 0, w: 960, h: 540 }
    expect(previewBox(0.5, 0.5, r, 1920, 1080, 150)).toEqual({ x: 442.5, y: 232.5, w: 75, h: 75 })
    expect(previewBox(1, 1, r, 1920, 1080, 150)).toEqual({ x: 884.5, y: 464.5, w: 75, h: 75 })
  })

  it('previewBox rounds odd box sizes like the server', () => {
    const r = { x: 0, y: 0, w: 1920, h: 1080 }
    expect(previewBox(0.5, 0.5, r, 1920, 1080, 151).x).toBe(885)
    expect(previewBox(0.5, 0.5, r, 1920, 1080, 149).x).toBe(886)
  })

  it('rectToDisplay / detectionToDisplay map normalized boxes into the rect', () => {
    const r = { x: 100, y: 50, w: 800, h: 450 }
    expect(rectToDisplay({ x: 0.25, y: 0.5, w: 0.1, h: 0.2 }, r)).toEqual({ x: 300, y: 275, w: 80, h: 90 })
    expect(detectionToDisplay({ x0: 0.25, y0: 0.5, x1: 0.5, y1: 1, score: 0.9, class_id: 0, class_name: 'person' }, r)).toEqual({ x: 300, y: 275, w: 200, h: 225 })
  })

  it('pointToDisplay normalizes stream pixels through the cover rect', () => {
    expect(pointToDisplay([960, 540], [1920, 1080], { x: 0, y: -81.25, w: 1000, h: 562.5 })).toEqual({ x: 500, y: 200 })
  })
})
