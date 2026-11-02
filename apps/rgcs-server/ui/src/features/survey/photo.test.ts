import { describe, expect, it } from 'vitest'
import { ALPHA7R4 } from './spec'
import { altForGsd, blur, footprint, gsdCm, laneSpacingM, triggerDistM, turnRadiusM } from './photo'

describe('photo math (alpha7R IV)', () => {
  it('gsd at 100 m', () => expect(gsdCm(ALPHA7R4, 100)).toBeCloseTo(1.0732, 3))
  it('altitude for a GSD', () => expect(altForGsd(ALPHA7R4, 2)).toBeCloseTo(186.35, 2))
  it('footprint landscape / portrait', () => {
    const l = footprint(ALPHA7R4, 100, 'landscape')
    expect(l.alongM).toBeCloseTo(68.0, 6)
    expect(l.acrossM).toBeCloseTo(102.0, 6)
    const p = footprint(ALPHA7R4, 100, 'portrait')
    expect(p.alongM).toBeCloseTo(102.0, 6)
    expect(p.acrossM).toBeCloseTo(68.0, 6)
  })
  it('trigger distance and lane spacing', () => {
    const fp = footprint(ALPHA7R4, 100, 'landscape')
    expect(triggerDistM(fp, 80)).toBeCloseTo(13.6, 6)
    expect(laneSpacingM(fp, 70)).toBeCloseTo(30.6, 6)
  })
  it('motion blur', () => {
    const b = blur(ALPHA7R4, 20, 1.0732)
    expect(b.cm).toBeCloseTo(2.0, 6)
    expect(b.px).toBeCloseTo(1.8635, 3)
  })
  it('turn radius', () => {
    expect(turnRadiusM(18, 30)).toBeCloseTo(57.22, 2)
    expect(turnRadiusM(22, 30)).toBeCloseTo(85.48, 2)
  })
})
