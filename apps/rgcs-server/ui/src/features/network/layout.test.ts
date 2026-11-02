import { describe, expect, it } from 'vitest'
import { clientSession, mavLink, netVehicle, topology } from './fixture'
import { toGraph } from './graph'
import { CWD, layoutNetwork, linkPillY, MEDIA_PILL_W, mediaPillX, RH, VH, VW, zoneLabelFs } from './layout'

const graphOf = (n: number, clients = 1) =>
  toGraph(topology(1, { links: [mavLink()], vehicles: Array.from({ length: n }, (_, i) => netVehicle(i + 1)), clients: Array.from({ length: clients }, (_, i) => clientSession(i + 1)) }))

describe('layoutNetwork', () => {
  it('exports the prototype grid constants', () => {
    expect([RH, CWD, VW, VH]).toEqual([77, 306, 236, 70])
  })

  it('places one vehicle in one column with the server slot below it', () => {
    const l = layoutNetwork(graphOf(1))
    expect(l.pos.get(1)).toEqual([176, 62])
    expect(l.cols).toBe(1)
    expect(l.rows).toBe(1)
    expect(l.vx).toBe(176)
    expect(l.gwY).toBe(62 + 77 + 34)
    expect(l.S).toBe(1)
  })

  it('wraps nine vehicles into a second column of the 8-row grid', () => {
    const l = layoutNetwork(graphOf(9))
    expect(l.cols).toBe(2)
    expect(l.rows).toBe(8)
    expect(l.vx).toBe(150)
    expect(l.pos.get(9)).toEqual([456, 62])
    expect(l.pos.get(8)).toEqual([150, 62 + 7 * 77])
  })

  it.each([1, 3, 8, 12])('keeps the link pill clear of the vehicles and the server card (%i vehicles)', (n) => {
    const l = layoutNetwork(graphOf(n))
    const lastBottom = Math.max(...[...l.pos.values()].map(([, y]) => y + VH))
    expect(linkPillY(l) - 10).toBeGreaterThanOrEqual(lastBottom + 8)
    expect(linkPillY(l) + 10).toBeLessThanOrEqual(l.gwY - 8)
  })

  it('grows the site zone by 58 px per extra client', () => {
    const one = layoutNetwork(graphOf(1, 1))
    const three = layoutNetwork(graphOf(1, 3))
    expect(one.zone.h).toBe(77 + 220 + 70)
    expect(three.zone.h - one.zone.h).toBe(2 * 58)
  })

  it('orders the bands left to right inside a world that holds them', () => {
    const l = layoutNetwork(graphOf(2))
    expect(l.IX).toBeGreaterThan(l.zone.x + l.zone.w)
    expect(l.HX).toBeGreaterThan(l.IX + l.IW)
    expect(l.UX).toBeGreaterThan(l.HX + l.HW)
    expect(l.W).toBeGreaterThan(l.UX)
    expect(l.H).toBeGreaterThanOrEqual(l.HY + l.HH)
  })

  it('puts the media pill beside the server card, inside the site zone', () => {
    for (const n of [1, 3, 8, 12]) {
      const l = layoutNetwork(graphOf(n))
      expect(mediaPillX(l)).toBeGreaterThanOrEqual(l.vx + 110 + 4)
      expect(mediaPillX(l) + MEDIA_PILL_W).toBeLessThanOrEqual(l.zone.x + l.zone.w)
    }
  })
})

describe('zoneLabelFs', () => {
  it('keeps the requested size when the label fits', () => {
    expect(zoneLabelFs('クラウド', 400, 11)).toBe(11)
  })

  it('shrinks a label so it fits the zone width (compact / site LOD)', () => {
    const fs = zoneLabelFs('インターネット', 130, 44)
    expect(fs).toBeLessThan(44)
    expect(fs * 7).toBeLessThanOrEqual(130 - 32)
  })

  it('counts ASCII as narrower than full-width text', () => {
    expect(zoneLabelFs('Internet', 130, 44)).toBeGreaterThan(zoneLabelFs('インターネット', 130, 44))
  })
})
