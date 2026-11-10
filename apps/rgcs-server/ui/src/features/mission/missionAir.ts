// 3D mission path (prototype updateMissionAir): one altitude polyline per leg coloured by
// its climb angle (steep climbs turn red), a post per positioned item (amber when selected), ground discs, and the altitude of
// every badge and mid-leg handle so the DOM markers can float to it; survey outlines draped on the ground.
import { useEffect, useRef, type RefObject } from 'react'
import type { DemEncoding } from '../map/terrain'
import type { FeatureCollection, Point } from 'geojson'
import type { Map as MlMap, Marker } from 'maplibre-gl'
import { climbColor, climbTint, itemAmsl, mercatorLine, vehicleAmsl, type AirPoint, type AirVertex, type ElevAt, type Rgb } from '../map/air'
import { useAir3d } from '../map/air3d'
import { modelFor } from '../map/models/meshes'
import { floatMarkers, pixelsPerMetre, type Floating } from '../map/float'
import type { MapMode } from '../map/mapMode'
import { arcPoints, isArc } from './arc'
import { circleRing } from './geofenceModel'
import type { FenceZone, VehicleState } from '../../shared/api/types'
import { haversineM, hasPosition, type LatLon } from './geo'
import type { Draft, DraftItem } from './model'
import type { PathPoint } from '../flightpath/planePath'
import type { OtherMission } from '../plans/overlay'
import { surveyOutlines } from '../survey/surveyAir'

const POST: Rgb = [0xbf / 255, 0xe0 / 255, 1]
const AMBER: Rgb = [0xf2 / 255, 0xb5 / 255, 0x44 / 255]
export const FRAME_LABEL = { rel: 'REL', abs: 'ABS', ter: 'TER' } as const

export const AIR = 'mission-air3d'
export const FOOT = 'mission-foot'
export const GROUND = 'mission-ground'
export const MISSION_3D_LAYERS = { only3d: [FOOT, GROUND], only2d: ['mission-path-casing', 'mission-path-line', 'mission-predicted-line'] }

export interface MissionAir {
  readonly lines: AirVertex[][]
  readonly posts: AirVertex[][]
  readonly discs: FeatureCollection<Point, { sel: number }>
  /** AMSL per item uid, `null` while unknown. */
  readonly alts: ReadonlyMap<number, number | null>
  /** AMSL at the mid-leg handle of each leg, by the uid that ends the leg (`MidHandle.toUid`). */
  readonly mids: ReadonlyMap<number, number | null>
}

type Pt = { lat: number; lon: number; amsl: number }

interface Stop {
  readonly lat: number
  readonly lon: number
  readonly amsl: number
  readonly item: DraftItem | null
}

/** "80 m REL" (3D badge chip): the frame spelled like the list and the selects. */
export const altChip = (it: DraftItem): string => `${Math.round(it.alt)} m ${FRAME_LABEL[it.frame]}`

function legPoints(a: Stop, b: Stop, elevAt: ElevAt): Pt[] {
  const len = haversineM(a.lat, a.lon, b.lat, b.lon)
  const ter = a.item?.frame === 'ter' && b.item?.frame === 'ter'
  const arc = b.item && isArc(b.item) ? b.item.params[0] : 0
  const n0 = ter ? Math.min(200, Math.max(2, Math.ceil(len / 20))) : Math.max(2, Math.min(8, Math.ceil(len / 400)))
  const n = arc ? Math.max(n0, 16) : n0
  // an ARC_WAYPOINT leg follows its arc; the altitude still changes linearly along it
  const bent = arc ? arcPoints(a, b, arc, n) : null
  // a sub-degree arc or a zero chord comes back as [a, b]: draw it straight
  const along = bent && bent.length === n + 1 ? bent : null
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = k / n
    const lat = along ? along[k]!.lat : a.lat + (b.lat - a.lat) * t
    const lon = along ? along[k]!.lon : a.lon + (b.lon - a.lon) * t
    const g = ter ? elevAt(lon, lat) : null
    const amsl = ter && g !== null ? g + a.item!.alt + (b.item!.alt - a.item!.alt) * t : a.amsl + (b.amsl - a.amsl) * t
    return { lat, lon, amsl }
  })
}

type Climb = (dz: number, dh: number) => Rgb

/** Each vertex takes the climb of the segment that leaves it (the last one, the segment into it). */
function coloured(pts: readonly Pt[], climb: Climb = climbColor): AirPoint[] {
  return pts.map((p, i) => {
    const [a, b] = i < pts.length - 1 ? [p, pts[i + 1]!] : [pts[i - 1] ?? p, p]
    return { ...p, color: climb(b.amsl - a.amsl, haversineM(a.lat, a.lon, b.lat, b.lon)) }
  })
}

const FENCE_OK: Rgb = [0x5f / 255, 0xd3 / 255, 0x9b / 255]
const FENCE_DANGER: Rgb = [1, 0x69 / 255, 0x61 / 255]

/**
 * The fence in 3D: each zone's outline at the FENCE_ALT_MAX ceiling (home ground + `ceiling`), and
 * posts from the ground up to it at the polygon vertices / four points of a circle.
 */
function fenceWalls(zones: readonly FenceZone[], ceilingAmsl: number, ground: (lon: number, lat: number) => number): { lines: AirVertex[][]; posts: AirVertex[][] } {
  const lines: AirVertex[][] = []
  const posts: AirVertex[][] = []
  for (const z of zones) {
    const color = z.inclusion ? FENCE_OK : FENCE_DANGER
    const ring = z.kind === 'circle' ? circleRing(z.center, z.radius, 32) : z.vertices.length >= 3 ? [...z.vertices, z.vertices[0]!] : []
    if (ring.length < 2) continue
    lines.push(mercatorLine(ring.map((p) => ({ lon: p.lon, lat: p.lat, amsl: ceilingAmsl, color }))))
    const corners = z.kind === 'circle' ? [0, 8, 16, 24].map((i) => ring[i]!) : z.vertices
    for (const p of corners) {
      const g = ground(p.lon, p.lat)
      posts.push(mercatorLine([{ lon: p.lon, lat: p.lat, amsl: Math.min(g, ceilingAmsl), color }, { lon: p.lon, lat: p.lat, amsl: Math.max(g, ceilingAmsl), color }]))
    }
  }
  return { lines, posts }
}

/** The path the vehicle is expected to fly (`flightpath`), altitudes above `home`. */
export interface Predicted {
  readonly home: LatLon
  readonly points: readonly PathPoint[]
  /** How many points are the mission itself; the plane's RTL tail follows (absent: all of them). */
  readonly missionEnd?: number
}

/** Thin and translucent (the posts pass) so the planned legs stay the main line; climb-coloured. */
function predictedLine(pred: Predicted | null, elevAt: ElevAt): AirVertex[][] {
  if (!pred || pred.points.length < 2) return []
  const ground = elevAt(pred.home.lon, pred.home.lat)
  if (ground === null) return []
  return [mercatorLine(coloured(pred.points.map((p) => ({ lat: p.lat, lon: p.lon, amsl: ground + p.alt }))))]
}

/**
 * `ceiling`: FENCE_ALT_MAX (m above home) to raise the fence zones to, `null` = no walls.
 * `vehicleHome`: the target vehicle's home, the ceiling's base when the plan has neither home nor items.
 */
interface Route {
  readonly items: DraftItem[]
  readonly home: LatLon | null
  readonly homeGround: number | null
  readonly alts: ReadonlyMap<number, number | null>
  readonly stops: readonly Stop[]
  /** The sampled points of each leg (home → first item → …), AMSL by the item's frame. */
  readonly legs: Pt[][]
}

/** Rel = home ground (DEM at the home / first positioned item) + alt, Abs = alt, Ter = DEM at the point + alt. */
function routeOf(draft: Draft, elevAt: ElevAt): Route {
  const items = draft.items.filter(hasPosition)
  const home: LatLon | null = draft.mission.home ?? items[0] ?? null
  const alts = new Map(items.map((it) => [it.uid, itemAmsl(it, home, elevAt)] as const))
  const homeGround = home ? elevAt(home.lon, home.lat) : null
  const stops: Stop[] = items.flatMap((it) => {
    const amsl = alts.get(it.uid)
    return amsl === null || amsl === undefined ? [] : [{ lat: it.lat, lon: it.lon, amsl, item: it }]
  })
  const route = draft.mission.home && homeGround !== null && stops.length > 0 ? [{ ...draft.mission.home, amsl: homeGround, item: null }, ...stops] : stops
  const legs = route.slice(1).map((b, i) => legPoints(route[i]!, b, elevAt))
  return { items, home, homeGround, alts, stops, legs }
}

/** The base the dimmed lines of the other plans mix toward (`AirVertex.c` has no alpha). */
const DIM_BASE: Rgb = [0x11 / 255, 0x16 / 255, 0x1e / 255]
const DIM = 0.45

const hexRgb = (hex: string): Rgb => {
  const n = Number.parseInt(hex.replace('#', '').slice(0, 6), 16)
  return Number.isFinite(n) ? [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] : DIM_BASE
}

/** The plan's row colour mixed DIM toward DIM_BASE. */
export function dimmed(hex: string): Rgb {
  const c = hexRgb(hex)
  return [c[0] + (DIM_BASE[0] - c[0]) * DIM, c[1] + (DIM_BASE[1] - c[1]) * DIM, c[2] + (DIM_BASE[2] - c[2]) * DIM]
}

/** One 3D line per other open plan along its positioned items, in its dimmed row colour (no posts). */
export function othersAirLines(others: readonly OtherMission[], elevAt: ElevAt): AirVertex[][] {
  return others.flatMap((o) => {
    const { legs } = routeOf(o.draft, elevAt)
    if (legs.length === 0) return []
    const color = dimmed(o.color)
    // consecutive legs share their joining stop
    const pts = legs.flatMap((leg, i) => (i === 0 ? leg : leg.slice(1)))
    return [mercatorLine(pts.map((p) => ({ ...p, color })))]
  })
}

/** `color`: the mission's row colour for its legs (steep climbs still turn red); null = the climb scale. */
export function missionAirData(draft: Draft, selected: ReadonlySet<number>, elevAt: ElevAt, ceiling: number | null = null, vehicleHome: LatLon | null = null, predicted: Predicted | null = null, color: string | null = null): MissionAir {
  const { items, home, homeGround, alts, stops, legs } = routeOf(draft, elevAt)
  const base = color === null ? null : hexRgb(color)
  const climb: Climb = base ? (dz, dh) => climbTint(base, dz, dh) : climbColor
  const lines = legs.map((leg) => mercatorLine(coloured(leg, climb)))
  const discs: FeatureCollection<Point, { sel: number }> = { type: 'FeatureCollection', features: [] }
  const posts = stops.flatMap((s) => {
    const g = elevAt(s.lon, s.lat) ?? homeGround
    if (g === null) return []
    const c = selected.has(s.item!.uid) ? AMBER : POST
    discs.features.push({ type: 'Feature', properties: { sel: selected.has(s.item!.uid) ? 1 : 0 }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })
    return [mercatorLine([{ lon: s.lon, lat: s.lat, amsl: Math.min(g, s.amsl), color: c }, { lon: s.lon, lat: s.lat, amsl: Math.max(g, s.amsl), color: c }])]
  })
  // `midHandles` puts at most one handle between each pair of consecutive positioned items
  const mids = new Map(
    items.slice(1).map((b, i) => {
      const za = alts.get(items[i]!.uid)
      const zb = alts.get(b.uid)
      return [b.uid, za == null || zb == null ? null : (za + zb) / 2] as const
    }),
  )
  const floor = home ? homeGround : vehicleHome ? elevAt(vehicleHome.lon, vehicleHome.lat) : null
  const walls = ceiling !== null && floor !== null ? fenceWalls(draft.mission.fence, floor + ceiling, (lon, lat) => elevAt(lon, lat) ?? floor) : { lines: [], posts: [] }
  const surveys = surveyOutlines(draft.surveys, elevAt, homeGround)
  return { lines: [...lines, ...walls.lines, ...surveys], posts: [...posts, ...walls.posts, ...predictedLine(predicted, elevAt)], discs, alts, mids }
}

type Badges = ReadonlyMap<number, { marker: Marker }>
type Handles = readonly { readonly marker: Marker; readonly toUid: number }[]

/** The plan's markers at their altitudes, each with its ground (sampled once here, not per frame). */
function planFloats(draft: Draft, d: MissionAir, badges: Badges, handles: Handles, elevAt: ElevAt): Floating[] {
  const byUid = new Map(draft.items.map((it) => [it.uid, it]))
  const badgeFloats = [...badges.entries()].flatMap(([uid, { marker }]) => {
    const it = byUid.get(uid)
    return it ? [{ marker, lon: it.lon, lat: it.lat, amsl: d.alts.get(uid) ?? null, base: [0, 0] as const, ground: elevAt(it.lon, it.lat) }] : []
  })
  const handleFloats = handles.map(({ marker, toUid }) => {
    const p = marker.getLngLat()
    return { marker, lon: p.lng, lat: p.lat, amsl: d.mids.get(toUid) ?? null, base: [0, 0] as const, ground: elevAt(p.lng, p.lat) }
  })
  return [...badgeFloats, ...handleFloats]
}

interface Args {
  readonly map: RefObject<MlMap | null>
  readonly loaded: RefObject<boolean>
  readonly mode: MapMode
  readonly terrainTiles: string | null
  readonly terrainEncoding?: DemEncoding
  readonly draft: Draft
  readonly selected: ReadonlySet<number>
  readonly badges: RefObject<Badges>
  /** The mid-leg "+" markers, each with the uid ending its leg. */
  readonly handles: RefObject<Handles>
  /** FENCE_ALT_MAX: the fence zones rise to it in 3D (above `vehicleHome` when the plan has no home). */
  readonly ceiling?: number | null
  readonly vehicleHome?: LatLon | null
  readonly predicted?: Predicted | null
  /** The other shown plans, drawn as dimmed lines beside the plan. */
  readonly others?: readonly OtherMission[]
  /** The mission's row colour (null: the climb scale). */
  readonly color?: string | null
}

const NO_OTHERS: readonly OtherMission[] = []

function setup(m: MlMap): void {
  m.addSource(GROUND, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  m.addLayer({ id: FOOT, type: 'line', source: 'mission-path', layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#9cc9ff', 'line-width': 1.5, 'line-opacity': 0.5 } })
  m.addLayer({
    id: GROUND,
    type: 'circle',
    source: GROUND,
    layout: { visibility: 'none' },
    paint: { 'circle-radius': 5, 'circle-color': ['case', ['==', ['get', 'sel'], 1], '#f2b544', '#9cc9ff'], 'circle-stroke-color': '#0f1824', 'circle-stroke-width': 2, 'circle-opacity': 0.95, 'circle-pitch-alignment': 'map' },
  })
}

/** The planner's target vehicle model colour (`--accent`). */
const VEHICLE_ACCENT: Rgb = [0x9c / 255, 0xc9 / 255, 1]

export interface MissionAir3d {
  readonly is3d: boolean
  /** Screen pixels per metre of altitude at an item in the last 3D frame, `null` before one. */
  readonly pxPerMetre: (uid: number) => number | null
  /** The target vehicle's marker flies at its altitude in 3D (`base`: its 2D offset). */
  readonly floatVehicle: (marker: Marker | null, v: VehicleState | null, base: readonly [number, number]) => void
}

export function useMissionAir({ map, loaded, mode, terrainTiles, terrainEncoding = 'terrarium', draft, selected, badges, handles, ceiling = null, vehicleHome = null, predicted = null, others = NO_OTHERS, color = null }: Args): MissionAir3d {
  const { sampler, ready, is3d, tick, layer, models, floats, live, matrix } = useAir3d({ map, loaded, mode, terrainTiles, terrainEncoding, layerId: AIR, setup, modeLayers: MISSION_3D_LAYERS })
  const latest = useRef({ draft, alts: new Map<number, number | null>() as ReadonlyMap<number, number | null> })
  // the vehicle's home matters only as the fence ceiling's base under a plan with no home or items: a
  // vehicle without a home reports its position here, which must not rebuild the plan every update
  const floorBase = ceiling !== null && !draft.mission.home && !draft.items.some(hasPosition) ? vehicleHome : null
  useEffect(() => {
    const m = map.current
    if (!m || !ready || !sampler || !is3d) return
    const d = missionAirData(draft, selected, sampler.elevAt, ceiling, floorBase, predicted, color)
    latest.current = { draft, alts: d.alts }
    floats.current = planFloats(draft, d, badges.current, handles.current, sampler.elevAt)
    layer.setLines([...d.lines, ...othersAirLines(others, sampler.elevAt)], d.posts)
    const src = m.getSource(GROUND) as { setData: (x: unknown) => void } | undefined
    src?.setData(d.discs)
  }, [map, ready, is3d, sampler, draft, selected, badges, handles, tick, layer, floats, ceiling, floorBase?.lat, floorBase?.lon, predicted, others, color])


  const pxPerMetre = (uid: number): number | null => {
    const m = map.current
    const it = latest.current.draft.items.find((x) => x.uid === uid)
    if (!m || !matrix.current || !it) return null
    const el = m.getContainer()
    // before its ground is known an item floats at 0 m: the scale barely depends on it
    return pixelsPerMetre(matrix.current, { w: el.clientWidth, h: el.clientHeight }, it.lon, it.lat, latest.current.alts.get(uid) ?? 0)
  }
  const lastVehicle = useRef<{ marker: Marker | null; v: VehicleState | null; base: readonly [number, number] }>({ marker: null, v: null, base: [0, 0] })
  const placeVehicle = () => {
    const { marker, v, base } = lastVehicle.current
    // DEM home ground + alt_rel matches how the plan's altitudes are drawn; alt_msl until the DEM is in
    const amsl = v ? ((sampler ? vehicleAmsl(v, vehicleHome, sampler.elevAt)?.amsl : undefined) ?? v.alt_msl) : null
    live.current = marker && v && amsl !== null ? [{ marker, lon: v.lon, lat: v.lat, amsl, base, ground: sampler?.elevAt(v.lon, v.lat) ?? null }] : []
    // in 3D the model stands for the vehicle; the marker keeps its name pill
    marker?.getElement().classList.toggle('model3d', is3d && ready)
    models.setModels(v && amsl !== null ? [{ sysid: v.sysid, model: modelFor(v.kind, v.vtol ?? false), at: { lon: v.lon, lat: v.lat, amsl }, hdg: v.hdg ?? 0, accent: VEHICLE_ACCENT, attitude: v.attitude ?? null }] : [])
    const m = map.current
    // a telemetry update moves the vehicle only: the plan's markers float with the camera
    if (m && matrix.current && is3d) floatMarkers(m, matrix.current, live.current)
  }
  const placeRef = useRef(placeVehicle)
  placeRef.current = placeVehicle
  // a 2D / 3D switch or a new DEM tile re-places the last vehicle
  useEffect(() => placeRef.current(), [is3d, ready, tick])
  const floatVehicle = (marker: Marker | null, v: VehicleState | null, base: readonly [number, number]) => {
    lastVehicle.current = { marker, v, base }
    placeVehicle()
  }
  return { is3d, pxPerMetre, floatVehicle }
}
