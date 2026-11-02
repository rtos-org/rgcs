import { describe, expect, it } from 'vitest'
import { t } from '../../shared/i18n'
import { CMDS } from './cmds'
import { durText, itemSummary } from './labels'

const dict = t('ja')
const trig = (dist: number) => ({ command: CMDS.DO_SET_CAM_TRIGG_DIST.id, frame: 'rel' as const, params: [dist, 0, 1, 0] as [number, number, number, number], lat: 0, lon: 0, alt: 0, autocontinue: true })

describe('itemSummary numbers', () => {
  it('a generated float reads as a short number, not 13.599999999999998', () => {
    const s = itemSummary(trig(13.599999999999998), 'plane', dict)
    expect(s).toContain('13.6')
    expect(s).not.toContain('13.59999')
  })
  it('whole numbers stay whole and at most two decimals are shown', () => {
    expect(itemSummary(trig(40), 'plane', dict)).toContain('40')
    expect(itemSummary(trig(1.23456), 'plane', dict)).toContain('1.23')
    expect(itemSummary(trig(1.23456), 'plane', dict)).not.toContain('1.234')
  })
})

describe('itemSummary for a rover', () => {
  it('drops the altitude prefix', () => {
    const wp = { command: CMDS.WAYPOINT.id, frame: 'rel' as const, params: [0, 0, 0, 0] as [number, number, number, number], lat: 36, lon: 139, alt: 50, autocontinue: true }
    expect(itemSummary(wp, 'rover', dict)).not.toContain('50 m')
    expect(itemSummary(wp, 'copter', dict)).toContain('50 m')
  })
})

describe('itemSummary wording', () => {
  const wp = (delay: number) => ({ command: CMDS.WAYPOINT.id, frame: 'rel' as const, params: [delay, 0, 0, 0] as [number, number, number, number], lat: 36, lon: 139, alt: 50, autocontinue: true })
  it('spells the altitude in words, no ▲ glyph', () => {
    expect(itemSummary(wp(0), 'copter', dict)).toBe('高度 50 m REL')
  })
  it('skips zero values', () => {
    expect(itemSummary(wp(5), 'copter', dict)).toContain('5s')
    expect(itemSummary(wp(0), 'copter', dict)).not.toContain('0s')
  })
})

describe('summary wording', () => {
  it('reads the estimated time in minutes and seconds', () => {
    expect(durText(368, dict)).toBe('6 分 08 秒')
    expect(durText(368, t('en'))).toBe('6 min 08 s')
  })
})
