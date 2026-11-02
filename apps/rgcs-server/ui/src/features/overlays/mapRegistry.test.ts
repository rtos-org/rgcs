import { describe, expect, it } from 'vitest'
import { viewRectOf, rectOf, registerMap } from './mapRegistry'

const bounds = (s: number, w: number, n: number, e: number) => ({ getSouth: () => s, getWest: () => w, getNorth: () => n, getEast: () => e })

describe('map registry', () => {
  it('rounds_and_clamps_the_view_to_a_valid_rectangle', () => {
    expect(rectOf(bounds(33.12345678, 135.1234567, 33.2, 135.3))).toEqual({ south: 33.123457, west: 135.123457, north: 33.2, east: 135.3 })
    expect(rectOf(bounds(-89, -200, 89, 200))).toEqual({ south: -84.9, west: -180, north: 84.9, east: 180 })
  })

  it('reads_the_registered_map_and_survives_a_throwing_one', () => {
    const off = registerMap('plan', () => bounds(1, 2, 3, 4))
    expect(viewRectOf('plan')).toEqual({ south: 1, west: 2, north: 3, east: 4 })
    off()
    expect(viewRectOf('plan')).toBeNull()
    const off2 = registerMap('plan', () => {
      throw new Error('gone')
    })
    expect(viewRectOf('plan')).toBeNull()
    off2()
  })

  it('a_stale_unregister_keeps_the_newer_map', () => {
    const first = registerMap('ops', () => bounds(1, 2, 3, 4))
    const second = registerMap('ops', () => bounds(5, 6, 7, 8))
    first()
    expect(viewRectOf('ops')?.south).toBe(5)
    second()
  })
})
