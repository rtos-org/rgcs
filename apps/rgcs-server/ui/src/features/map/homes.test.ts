import { describe, expect, it } from 'vitest'
import type { Mission } from '../../shared/api/types'
import { missionHomes, vehicleHomes } from './homes'
import type { VehicleState } from '../../shared/api/types'

const mission = (sysid: number, home: Mission['home']): Mission => ({ id: sysid, name: 'm', sysid, default_alt: 60, default_frame: 'rel', speed: 8, home, fence: [], rally: [], surveys: [], items: [] })

describe('missionHomes', () => {
  it('takes each known mission home and skips missing or null-island ones', () => {
    const homes = missionHomes(
      new Map([
        [1, mission(1, { lat: 36.1, lon: 139.3, alt: 400 })],
        [2, mission(2, null)],
        [3, mission(3, { lat: 0, lon: 0, alt: 0 })],
      ]),
    )
    expect([...homes]).toEqual([[1, { lat: 36.1, lon: 139.3 }]])
  })
})

describe('vehicleHomes', () => {
  const v = (sysid: number, home?: VehicleState['home']) => ({ sysid, home }) as VehicleState
  it('home_prefers_home_position_then_the_mission_home', () => {
    const vehicles = new Map([
      [1, v(1, { lat: 35, lon: 138, alt: 0 })],
      [2, v(2)],
    ])
    const missions = new Map([
      [1, mission(1, { lat: 36.1, lon: 139.3, alt: 400 })],
      [2, mission(2, { lat: 36.2, lon: 139.4, alt: 400 })],
    ])
    expect([...vehicleHomes(vehicles, missions)]).toEqual([
      [1, { lat: 35, lon: 138 }],
      [2, { lat: 36.2, lon: 139.4 }],
    ])
  })
})

