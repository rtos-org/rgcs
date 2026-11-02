import { describe, expect, it } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { sortVehicles } from './sort'

const v = (sysid: number, unread: number, warn = false) => ({ sysid, unread, warn }) as VehicleState

describe('sortVehicles', () => {
  const list = [v(3, 0), v(1, 0), v(4, 2), v(2, 0, true), v(5, 1)]
  it('by number keeps sysid order', () => {
    expect(sortVehicles(list, 'id').map((x) => x.sysid)).toEqual([1, 2, 3, 4, 5])
  })
  it('by alerts puts unread alerts first (most first), then warnings, then by number', () => {
    expect(sortVehicles(list, 'alerts').map((x) => x.sysid)).toEqual([4, 5, 2, 1, 3])
  })
})
