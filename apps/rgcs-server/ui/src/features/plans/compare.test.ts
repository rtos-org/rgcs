import { describe, expect, it } from 'vitest'
import { emptyDraft, type Draft } from '../mission/model'
import { compareRows } from './compare'

// A single waypoint with `hold` seconds of hold time: no distance (no home, first item), duration = hold.
const holdDraft = (hold: number): Draft => ({
  ...emptyDraft(),
  items: [{ uid: 1, command: 16, frame: 'rel', params: [hold, 0, 0, 0], lat: 36.1, lon: 139.1, alt: 50, autocontinue: true }],
})

describe('compare', () => {
  it('distance_time_and_battery_estimate', () => {
    const [ten, fifteen, none] = compareRows([
      { key: 'a', draft: holdDraft(600), enduranceMin: 20 },
      { key: 'b', draft: holdDraft(900), enduranceMin: 20 },
      { key: 'c', draft: holdDraft(600), enduranceMin: null },
    ])
    expect(ten).toMatchObject({ key: 'a', distanceM: 0, durationS: 600, batteryPct: 50, batteryWarn: false })
    expect(fifteen).toMatchObject({ key: 'b', durationS: 900, batteryPct: 75, batteryWarn: true })
    expect(none).toMatchObject({ key: 'c', batteryPct: null, batteryWarn: false })
  })

  it('zero_or_negative_endurance_gives_no_battery_figure', () => {
    const rows = compareRows([
      { key: 'z', draft: holdDraft(600), enduranceMin: 0 },
      { key: 'n', draft: holdDraft(600), enduranceMin: -5 },
    ])
    expect(rows.map((r) => r.batteryPct)).toEqual([null, null])
    expect(rows.map((r) => r.batteryWarn)).toEqual([false, false])
  })

  it('distance_comes_from_stats', () => {
    const draft: Draft = {
      ...emptyDraft(),
      mission: { ...emptyDraft().mission, home: { lat: 36.1, lon: 139.1, alt: 0 } },
      items: [{ uid: 1, command: 16, frame: 'rel', params: [0, 0, 0, 0], lat: 36.1, lon: 139.11, alt: 50, autocontinue: true }],
    }
    const [row] = compareRows([{ key: 'd', draft, enduranceMin: null }])
    expect(row?.distanceM).toBeGreaterThan(850)
    expect(row?.distanceM).toBeLessThan(900)
  })
})
