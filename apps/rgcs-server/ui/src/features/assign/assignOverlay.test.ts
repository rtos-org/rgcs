import { describe, expect, it } from 'vitest'
import type { Assignment, Mission, MissionItem, VehicleState } from '../../shared/api/types'
import { assignGeoJson, fitAllPoints, focusPoints, type AssignOverlayInput, type OverlayPlan } from './assignOverlay'

const item = (command: number, lat: number, lon: number): MissionItem => ({ command, frame: 'rel', params: [0, 0, 0, 0], lat, lon, alt: 50, autocontinue: true })

const mission = (id: number, items: readonly MissionItem[]): Mission => ({
  id, name: `p${id}`, sysid: null, default_alt: 50, default_frame: 'rel', speed: 8, home: null, items: [...items], fence: [], rally: [], surveys: [],
})

// the takeoff carries no position: the start is the first positioned item
const plan = (id: number, [a, b, c]: readonly [number, number, number]): OverlayPlan => ({ id, name: `Plan ${id}`, mission: mission(id, [item(22, 0, 0), item(16, a, 137.6), item(16, b, 137.61), item(16, c, 137.6)]) })

const vehicle = (sysid: number, lat: number, lon: number, fix = 3): VehicleState => ({
  sysid, name: `UAV-0${sysid}`, kind: 'copter', mode: 'STABILIZE', armed: false, lat, lon, alt_rel: 0, alt_msl: 0, hdg: 0,
  ground_speed: 0, climb: 0, battery: { pct: 90, volt: 24, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix, sats: 12, hdop: 1 }, warn: false, unread: 0,
})

const assign = (sysid: number, plan_id: number | null): Assignment => ({ sysid, plan_id, assigned_by: 'admin', assigned_at: 1, written: null })

const colours = new Map([[1, '#ff0000'], [2, '#00ff00']])

function input(over: Partial<AssignOverlayInput> = {}): AssignOverlayInput {
  return {
    plans: [plan(1, [36.25, 36.26, 36.27]), plan(2, [36.3, 36.31, 36.32])],
    colours,
    vehicles: [vehicle(1, 36.2, 137.5), vehicle(2, 36.21, 137.5), vehicle(3, 0, 0, 0)],
    // plan 1 on vehicles 1, 2 and 3: one link each for 1 and 2, none for 3 (no position); plan 2 unassigned
    assignments: new Map([[1, assign(1, 1)], [2, assign(2, 1)], [3, assign(3, 1)]]),
    highlight: null,
    ...over,
  }
}

type Props = Record<string, unknown>
const props = (fc: { features: { properties: unknown }[] }) => fc.features.map((f) => f.properties as Props)

describe('assignGeoJson', () => {
  it('overlay_features_for_plans_links_and_vehicles', () => {
    const g = assignGeoJson(input())
    // one line per plan through its positioned items, coloured, assigned 1 / unassigned 0.38
    expect(props(g.routes)).toEqual([
      { plan: 1, color: '#ff0000', opacity: 1 },
      { plan: 2, color: '#00ff00', opacity: 0.38 },
    ])
    expect(g.routes.features[0]!.geometry).toEqual({ type: 'LineString', coordinates: [[137.6, 36.25], [137.61, 36.26], [137.6, 36.27]] })
    expect(g.points.features).toHaveLength(6)
    expect(props(g.labels)).toEqual([
      { plan: 1, name: 'Plan 1', color: '#ff0000', opacity: 1 },
      { plan: 2, name: 'Plan 2', color: '#00ff00', opacity: 0.38 },
    ])
    expect(g.labels.features[0]!.geometry).toEqual({ type: 'Point', coordinates: [137.6, 36.25] })
    // one dashed link per positioned assigned vehicle, from the vehicle to its plan's start
    expect(props(g.links)).toEqual([
      { sysid: 1, plan: 1, color: '#ff0000', opacity: 1 },
      { sysid: 2, plan: 1, color: '#ff0000', opacity: 1 },
    ])
    expect(g.links.features[0]!.geometry).toEqual({ type: 'LineString', coordinates: [[137.5, 36.2], [137.6, 36.25]] })
    // positioned vehicles only
    expect(g.vehicles.map((v) => [v.sysid, v.opacity, v.color])).toEqual([[1, 1, '#ff0000'], [2, 1, '#ff0000']])
  })

  it('highlight_dims_the_rest', () => {
    const byPlan = assignGeoJson(input({ highlight: { plan: 2 } }))
    expect(props(byPlan.routes).map((p) => p.opacity)).toEqual([0.12, 0.38])
    expect(props(byPlan.links).map((p) => p.opacity)).toEqual([0.12, 0.12])
    expect(byPlan.vehicles.map((v) => v.opacity)).toEqual([0.12, 0.12])
    const byVehicle = assignGeoJson(input({ highlight: { vehicle: 2 } }))
    expect(props(byVehicle.routes).map((p) => p.opacity)).toEqual([1, 0.12])
    expect(props(byVehicle.points).map((p) => p.opacity)).toEqual([1, 1, 1, 0.12, 0.12, 0.12])
    expect(props(byVehicle.labels).map((p) => p.opacity)).toEqual([1, 0.12])
    expect(props(byVehicle.links).map((p) => p.opacity)).toEqual([0.12, 1])
    expect(byVehicle.vehicles.map((v) => v.opacity)).toEqual([0.12, 1])
  })
})

describe('fit and focus', () => {
  const { plans, vehicles, assignments } = input()

  it('fit_all_includes_vehicles', () => {
    const pts = fitAllPoints(plans, vehicles)
    expect(pts).toHaveLength(8)
    expect(pts).toContainEqual({ lat: 36.2, lon: 137.5 })
    expect(pts).toContainEqual({ lat: 36.32, lon: 137.6 })
    // the vehicle without a fix stays out
    expect(pts).not.toContainEqual({ lat: 0, lon: 0 })
  })

  it('focus_vehicle_without_position_reports', () => {
    expect(focusPoints({ vehicle: 3 }, plans, vehicles, assignments)).toEqual({ error: 'noPosition' })
    expect(focusPoints({ vehicle: 9 }, plans, vehicles, assignments)).toEqual({ error: 'noPosition' })
  })

  it('focus_vehicle_with_plan_includes_its_start', () => {
    expect(focusPoints({ vehicle: 1 }, plans, vehicles, assignments)).toEqual({ points: [{ lat: 36.2, lon: 137.5 }, { lat: 36.25, lon: 137.6 }] })
    const none = new Map([[1, assign(1, null)]])
    expect(focusPoints({ vehicle: 1 }, plans, vehicles, none)).toEqual({ points: [{ lat: 36.2, lon: 137.5 }] })
  })

  it('focus_plan_frames_its_items', () => {
    expect(focusPoints({ plan: 2 }, plans, vehicles, assignments)).toEqual({ points: [{ lat: 36.3, lon: 137.6 }, { lat: 36.31, lon: 137.61 }, { lat: 36.32, lon: 137.6 }] })
  })
})
