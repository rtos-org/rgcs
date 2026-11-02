import { describe, expect, it } from 'vitest'
import type { InspectorRow } from '../../shared/api/types'
import { componentName, groupRows, rowKey } from './tree'

const row = (dir: 'rx' | 'tx', sysid: number, compid: number, name: string, msg_id = 0): InspectorRow => ({ dir, sysid, compid, msg_id, name, count: 1, rate_hz: 1, age_ms: 0 })

describe('inspector tree', () => {
  it('tree_groups_by_direction_system_component', () => {
    const tree = groupRows([row('rx', 1, 1, 'HEARTBEAT'), row('rx', 1, 1, 'ATTITUDE', 30), row('rx', 1, 100, 'HEARTBEAT'), row('tx', 255, 190, 'COMMAND_LONG', 76)], '')
    expect(tree.map((d) => d.dir)).toEqual(['rx', 'tx'])
    expect(tree[0]!.systems[0]!.components.map((c) => c.compid)).toEqual([1, 100])
    expect(tree[0]!.systems[0]!.components[0]!.rows.map((r) => r.name)).toEqual(['ATTITUDE', 'HEARTBEAT'])
    expect(tree[1]!.systems[0]!.sysid).toBe(255)
  })

  it('filter_matches_message_names', () => {
    const tree = groupRows([row('rx', 1, 1, 'HEARTBEAT'), row('rx', 1, 1, 'ATTITUDE', 30)], 'att')
    expect(tree[0]!.systems[0]!.components[0]!.rows.map((r) => r.name)).toEqual(['ATTITUDE'])
    expect(groupRows([row('rx', 1, 1, 'HEARTBEAT')], 'zzz')).toEqual([])
  })

  it('names_known_components_and_keys_rows', () => {
    expect(componentName(1)).toBe('Autopilot')
    expect(componentName(100)).toBe('Camera')
    expect(componentName(42)).toBe('COMP 42')
    expect(rowKey(row('tx', 255, 190, 'X', 76))).toBe('tx/255/190/76')
  })
})
