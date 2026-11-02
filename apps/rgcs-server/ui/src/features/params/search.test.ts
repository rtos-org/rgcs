import { describe, expect, it } from 'vitest'
import type { ParamMeta } from './meta'
import { rank } from './search'

const meta: Record<string, ParamMeta> = {
  FENCE_ALT_MAX: { n: 'Fence Maximum Altitude', d: 'Maximum altitude allowed before geofence triggers', u: 'm', r: [10, 1000] },
  FENCE_ENABLE: { n: 'Fence enable/disable', d: 'Allows you to enable (1) or disable (0) the fence functionality', v: { '0': 'Disabled', '1': 'Enabled' } },
  AVOID_ENABLE: { n: 'Avoidance control enable', d: 'Enabled/disable avoidance input sources (includes fence)' },
  WPNAV_SPEED: { n: 'Waypoint horizontal speed', d: 'Defines the speed in cm/s which the aircraft will attempt to maintain' },
  GEOFENCE_X: { n: 'X', d: 'Unrelated', },
}
const entries = ['WPNAV_SPEED', 'FENCE_ENABLE', 'GEOFENCE_X', 'AVOID_ENABLE', 'FENCE_ALT_MAX'].map((name, i) => ({ name, value: i, index: i, ptype: 9 }))

describe('rank', () => {
  it('search_ranks_prefix_then_name_then_description', () => {
    const names = rank(entries, meta, 'fence').map((r) => r.name)
    expect(names).toEqual(['FENCE_ALT_MAX', 'FENCE_ENABLE', 'GEOFENCE_X', 'AVOID_ENABLE'])
    expect(rank(entries, meta, 'geofence').map((r) => r.name)).toEqual(['GEOFENCE_X', 'FENCE_ALT_MAX'])
  })

  it('empty_query_lists_everything_in_name_order_with_meta_attached', () => {
    const rows = rank(entries, meta, '  ')
    expect(rows.map((r) => r.name)).toEqual(['AVOID_ENABLE', 'FENCE_ALT_MAX', 'FENCE_ENABLE', 'GEOFENCE_X', 'WPNAV_SPEED'])
    expect(rows[1]!.meta?.u).toBe('m')
    expect(rank(entries, {}, '')[0]!.meta).toBeUndefined()
  })

  it('query_is_case_insensitive_and_matches_display_names', () => {
    expect(rank(entries, meta, 'Waypoint Horizontal').map((r) => r.name)).toEqual(['WPNAV_SPEED'])
    expect(rank(entries, meta, 'zzz')).toEqual([])
  })
})
