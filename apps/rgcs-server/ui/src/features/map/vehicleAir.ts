// 3D on the operations map (prototype updateVehicleAir): a thin post from the ground to each
// vehicle, a ground disc, the DOM marker floated to its altitude, the flight tracks in the air and
// the selected vehicle's mission drawn like the planner (display only).
import { useEffect, useRef, type RefObject } from 'react'
import type { FeatureCollection, Point } from 'geojson'
import type { Map as MlMap, Marker } from 'maplibre-gl'
import type { Mission, VehicleState } from '../../shared/api/types'
import { hasPosition as itemHasPosition } from '../mission/geo'
import { missionAirData, type Predicted } from '../mission/missionAir'
import { fromMission } from '../mission/model'
import { mercatorLine, vehicleAmsl, type AirVertex, type ElevAt, type Rgb } from './air'
import { useAir3d } from './air3d'
import { navTarget, vectorEnd } from './course'
import { orderLayers } from './layers'
import { hasPosition } from './markers'
import type { MapMode } from './mapMode'
import type { LatLon } from './store'
import type { Tracks } from './tracks'
import { modelFor } from './models/meshes'
import type { VehicleModel } from './models/modelLayer'

const CYAN: Rgb = [0x9c / 255, 0xc9 / 255, 1]
const AMBER: Rgb = [0xf2 / 255, 0xb5 / 255, 0x44 / 255]
const WHITE: Rgb = [1, 1, 1]
/** Mission Planner's track purple (#800080). */
const TRACK_PURPLE: Rgb = [0x80 / 255, 0, 0x80 / 255]
const GROUND = 'veh-ground'
const AIR = 'veh-air3d'
/** Layers shown only in 3D on the operations map. */
export const OPS_3D_LAYERS = { only3d: [GROUND], only2d: ['mission-path-line', 'mission-predicted-line', 'tracks-others', 'tracks-selected', 'course-nav', 'course-vector-casing', 'course-vector'] }

export interface VehicleAir {
  /** Flight tracks and mission legs. */
  readonly lines: AirVertex[][]
  readonly posts: AirVertex[][]
  readonly discs: FeatureCollection<Point, { sel: number }>
  /** Altitude AMSL per vehicle; `null` while its ground is unknown (the marker stays on the ground). */
  readonly alts: ReadonlyMap<number, number | null>
  /** AMSL of each positioned mission item, in item order (the mission badges float to it). */
  readonly missionAlts: readonly (number | null)[]
}

function homeOf(sysid: number, homes: ReadonlyMap<number, LatLon>, tracks: Tracks): LatLon | null {
  const h = homes.get(sysid)
  if (h) return h
  const first = tracks.get(sysid)?.[0]
  return first ? { lon: first[0], lat: first[1] } : null
}

/** Each track at its vehicle's home ground + the recorded relative altitude (like the vehicle), in Mission Planner purple. */
function trackLines(tracks: Tracks, homes: ReadonlyMap<number, LatLon>, elevAt: ElevAt): AirVertex[][] {
  return [...tracks].flatMap(([sysid, track]) => {
    const home = homeOf(sysid, homes, tracks)
    const ground = home ? elevAt(home.lon, home.lat) : null
    if (ground === null || track.length < 2) return []
    return [mercatorLine(track.map((p) => ({ lon: p[0], lat: p[1], amsl: ground + p[2], color: TRACK_PURPLE })))]
  })
}

/**
 * Where the vehicle is going, in the air: the velocity vector from the vehicle along its course,
 * climbing at its climb rate (white / cyan like 2D), and the line to the navigation target at
 * flight altitude (amber / cyan) with a post down to the ground disc of the 2D target dot.
 */
function courseAir(v: VehicleState, amsl: number, ground: number, sel: boolean): { lines: AirVertex[][]; posts: AirVertex[][] } {
  if (!hasPosition(v) || v.link === 'lost') return { lines: [], posts: [] }
  const lines: AirVertex[][] = []
  const posts: AirVertex[][] = []
  const vec = vectorEnd(v)
  if (vec) {
    const c = sel ? WHITE : CYAN
    lines.push(mercatorLine([{ lon: v.lon, lat: v.lat, amsl, color: c }, { lon: vec.end[0], lat: vec.end[1], amsl: amsl + v.climb * vec.seconds, color: c }]))
  }
  const nav = navTarget(v)
  if (nav) {
    const c = sel ? AMBER : CYAN
    lines.push(mercatorLine([{ lon: v.lon, lat: v.lat, amsl, color: c }, { lon: nav[0], lat: nav[1], amsl, color: c }]))
    posts.push(mercatorLine([{ lon: nav[0], lat: nav[1], amsl: Math.min(ground, amsl), color: c }, { lon: nav[0], lat: nav[1], amsl: Math.max(ground, amsl), color: c }]))
  }
  return { lines, posts }
}

export function vehicleAirData(vehicles: ReadonlyMap<number, VehicleState>, selected: number | null, homes: ReadonlyMap<number, LatLon>, tracks: Tracks, elevAt: ElevAt, mission: Mission | null = null, predicted: Predicted | null = null): VehicleAir {
  const posts: AirVertex[][] = []
  const discs: FeatureCollection<Point, { sel: number }> = { type: 'FeatureCollection', features: [] }
  const alts = new Map<number, number | null>()
  const course: AirVertex[][] = []
  vehicles.forEach((v) => {
    const a = vehicleAmsl(v, homeOf(v.sysid, homes, tracks), elevAt)
    alts.set(v.sysid, a ? a.amsl : null)
    if (a) {
      const air = courseAir(v, a.amsl, a.ground, v.sysid === selected)
      course.push(...air.lines)
      posts.push(...air.posts)
    }
    if (!a || v.alt_rel < 1) return
    const c = v.sysid === selected ? AMBER : CYAN
    posts.push(mercatorLine([{ lon: v.lon, lat: v.lat, amsl: Math.min(a.ground, a.amsl), color: c }, { lon: v.lon, lat: v.lat, amsl: Math.max(a.ground, a.amsl), color: c }]))
    discs.features.push({ type: 'Feature', properties: { sel: v.sysid === selected ? 1 : 0 }, geometry: { type: 'Point', coordinates: [v.lon, v.lat] } })
  })
  const plan = mission ? fromMission(mission) : null
  const m = plan ? missionAirData(plan, new Set(), elevAt, null, null, predicted) : null
  const missionAlts = plan ? plan.items.filter(itemHasPosition).map((it) => m!.alts.get(it.uid) ?? null) : []
  return {
    lines: [...trackLines(tracks, homes, elevAt), ...(m?.lines ?? []), ...course],
    posts: [...posts, ...(m?.posts ?? [])],
    discs: { ...discs, features: [...discs.features, ...(m?.discs.features ?? [])] },
    alts,
    missionAlts,
  }
}

interface Args {
  readonly map: RefObject<MlMap | null>
  readonly loaded: RefObject<boolean>
  readonly mode: MapMode
  readonly terrainTiles: string | null
  readonly vehicles: ReadonlyMap<number, VehicleState>
  readonly selected: number | null
  readonly homes: ReadonlyMap<number, LatLon>
  readonly tracks: Tracks
  readonly markers: RefObject<ReadonlyMap<number, { marker: Marker }>>
  /** The markers' 2D offset (the `.vmk` disc correction). */
  readonly base: readonly [number, number]
  /** The selected vehicle's mission and its badges (one per positioned item, in item order). */
  readonly mission?: Mission | null
  readonly missionBadges?: RefObject<readonly Marker[]>
  readonly predicted?: Predicted | null
}

function setupGround(m: MlMap): void {
  m.addSource(GROUND, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  m.addLayer({
    id: GROUND,
    type: 'circle',
    source: GROUND,
    layout: { visibility: 'none' },
    paint: { 'circle-radius': 6, 'circle-color': ['case', ['==', ['get', 'sel'], 1], '#f2b544', '#9cc9ff'], 'circle-stroke-color': '#0f1824', 'circle-stroke-width': 2, 'circle-opacity': 0.9, 'circle-pitch-alignment': 'map' },
  })
}

/** Each positioned vehicle as a model at its drawn altitude (its own AMSL until the DEM is in). */
export function vehicleModels(vehicles: ReadonlyMap<number, VehicleState>, selected: number | null, alts: ReadonlyMap<number, number | null>): VehicleModel[] {
  return [...vehicles.values()]
    .filter(hasPosition)
    .map((v) => ({ sysid: v.sysid, model: modelFor(v.kind, v.vtol ?? false), at: { lon: v.lon, lat: v.lat, amsl: alts.get(v.sysid) ?? v.alt_msl }, hdg: v.hdg ?? 0, accent: v.sysid === selected ? AMBER : CYAN, attitude: v.attitude ?? null }))
}

export interface OpsAir {
  /** When the last 2D / 3D switch started. */
  readonly modeSwitchAt: { readonly current: number }
  readonly is3d: boolean
  /** Each vehicle's AMSL as drawn in 3D (`null` while its ground is unknown); refreshed every frame of data. */
  readonly alts: { readonly current: ReadonlyMap<number, number | null> }
}

/** Terrain, posts and floated markers; a no-op without terrain tiles. */
export function useVehicleAir({ map, loaded, mode, terrainTiles, vehicles, selected, homes, tracks, markers, base, mission = null, missionBadges, predicted = null }: Args): OpsAir {
  const air = useAir3d({ map, loaded, mode, terrainTiles, layerId: AIR, setup: setupGround, modeLayers: OPS_3D_LAYERS, order: orderLayers })
  const { sampler, ready, is3d, tick, layer, models, floats, modeSwitchAt } = air
  // in 3D the model stands for the vehicle: the DOM marker keeps only its name / altitude pill
  useEffect(() => {
    markers.current.forEach(({ marker }) => marker.getElement().classList.toggle('model3d', is3d && ready))
  }, [markers, is3d, ready, vehicles])
  const alts = useRef<ReadonlyMap<number, number | null>>(new Map())

  useEffect(() => {
    const m = map.current
    // 2D needs no altitudes: no DEM downloads, no per-frame work
    if (!m || !ready || !sampler || !is3d) return
    const d = vehicleAirData(vehicles, selected, homes, tracks, sampler.elevAt, mission, predicted)
    alts.current = d.alts
    const vehicleFloats = [...markers.current.entries()].flatMap(([sysid, { marker }]) => {
      const v = vehicles.get(sysid)
      return v ? [{ marker, lon: v.lon, lat: v.lat, amsl: d.alts.get(sysid) ?? null, base }] : []
    })
    const badgeFloats = (missionBadges?.current ?? []).map((marker, i) => {
      const p = marker.getLngLat()
      return { marker, lon: p.lng, lat: p.lat, amsl: d.missionAlts[i] ?? null, base: [0, 0] as const }
    })
    floats.current = [...vehicleFloats, ...badgeFloats]
    layer.setLines(d.lines, d.posts)
    models.setModels(vehicleModels(vehicles, selected, d.alts))
    const src = m.getSource(GROUND) as { setData: (x: unknown) => void } | undefined
    src?.setData(d.discs)
  }, [map, ready, is3d, sampler, vehicles, selected, homes, tracks, markers, base, tick, layer, models, floats, mission, missionBadges, predicted])
  return { modeSwitchAt, is3d, alts }
}
