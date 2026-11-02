// Elevation profile (prototype elevProfile): the ground under the route and the flight
// altitude along it, in a 1000 × 100 SVG box, with one point per positioned item. Ground comes from
// the terrain tiles; while a tile is missing the home ground stands in (`hasDem` false).
import type { ElevAt } from '../map/air'
import { arcPoints, isArc } from './arc'
import { hasPosition, legDistanceM } from './geo'
import type { Draft, DraftItem } from './model'

const W = 1000
const H = 100

export interface ProfilePoint {
  readonly uid: number
  /** 1-based list position (the badge number). */
  readonly seq: number
  /** 0–100 % across / down the chart. */
  readonly x: number
  readonly y: number
  /** Metres above the ground under it, and above the home ground. */
  readonly agl: number
  readonly rel: number
  /** Distance along the route (m). */
  readonly d: number
}

export interface ElevProfile {
  readonly points: readonly ProfilePoint[]
  readonly groundD: string
  readonly pathD: string
  readonly postsD: string
  readonly yMin: number
  readonly yMax: number
  readonly total: number
  readonly hasDem: boolean
  /** Some part of the path is more than 0.5 m under the ground. */
  readonly belowGround: boolean
  /** FENCE_ALT_MAX as AMSL (home ground + alt max) and its chart position (0–100 %), or null. */
  readonly ceiling: number | null
  readonly ceilingY: number | null
}

interface Stop {
  readonly item: DraftItem
  readonly seq: number
  readonly amsl: number
  readonly d: number
}

/** `ceilingAlt`: FENCE_ALT_MAX (m above home) to draw as a line, `null` = none. */
export function elevProfile(draft: Draft, elevAt: ElevAt, ceilingAlt: number | null = null): ElevProfile | null {
  const positioned = draft.items.map((it, i) => ({ it, seq: i + 1 })).filter(({ it }) => hasPosition(it))
  if (positioned.length === 0) return null
  const home = draft.mission.home ?? positioned[0]!.it
  const homeGround = elevAt(home.lon, home.lat) ?? 0
  const ground = (lon: number, lat: number) => elevAt(lon, lat) ?? homeGround
  const hasDem = positioned.some(({ it }) => elevAt(it.lon, it.lat) !== null)
  const amslOf = (it: DraftItem) => (it.frame === 'abs' ? it.alt : it.frame === 'ter' ? ground(it.lon, it.lat) + it.alt : homeGround + it.alt)
  let cum = 0
  const stops: Stop[] = positioned.map(({ it, seq }, i) => {
    const prev = positioned[i - 1]?.it
    if (prev) cum += legDistanceM(prev, it)
    return { item: it, seq, amsl: amslOf(it), d: cum }
  })
  const total = Math.max(cum, 1)
  const samples = sample(stops, ground, Math.max(5, total / 700))
  const ceiling = ceilingAlt === null ? null : homeGround + ceilingAlt
  const zs = [...samples.flatMap((s) => [s.g, s.z]), ...(ceiling === null ? [] : [ceiling])]
  const lo = Math.min(...zs)
  const hi = Math.max(...zs)
  const span = Math.max(20, hi - lo)
  const yMin = lo - span * 0.1
  const yMax = hi + span * 0.18
  const X = (d: number) => (d / total) * W
  const Y = (v: number) => H - ((v - yMin) / (yMax - yMin)) * H
  const f = (n: number) => n.toFixed(1)
  return {
    points: stops.map((s) => {
      const g = ground(s.item.lon, s.item.lat)
      return { uid: s.item.uid, seq: s.seq, x: (X(s.d) / W) * 100, y: (Y(s.amsl) / H) * 100, agl: s.amsl - g, rel: s.amsl - homeGround, d: s.d }
    }),
    groundD: `M0,${H} ${samples.map((s) => `L${f(X(s.d))},${f(Y(s.g))}`).join(' ')} L${W},${H} Z`,
    pathD: samples.map((s, i) => `${i ? 'L' : 'M'}${f(X(s.d))},${f(Y(s.z))}`).join(' '),
    postsD: stops.map((s) => `M${f(X(s.d))},${f(Y(ground(s.item.lon, s.item.lat)))} L${f(X(s.d))},${f(Y(s.amsl))}`).join(' '),
    yMin,
    yMax,
    total: cum,
    hasDem,
    belowGround: samples.some((s) => s.z - s.g < -0.5),
    ceiling,
    ceilingY: ceiling === null ? null : (Y(ceiling) / H) * 100,
  }
}

/** Ground and flight altitude every `step` metres; Ter → Ter legs follow the ground. */
function sample(stops: readonly Stop[], ground: (lon: number, lat: number) => number, step: number): { d: number; g: number; z: number }[] {
  if (stops.length === 1) {
    const s = stops[0]!
    return [{ d: 0, g: ground(s.item.lon, s.item.lat), z: s.amsl }]
  }
  return stops.slice(1).flatMap((b, i) => {
    const a = stops[i]!
    const n = Math.max(1, Math.ceil((b.d - a.d) / step))
    const ter = a.item.frame === 'ter' && b.item.frame === 'ter'
    const bent = isArc(b.item) ? arcPoints(a.item, b.item, b.item.params[0], n) : null
    // a sub-degree arc or a zero chord comes back as [a, b]: sample it straight
    const along = bent && bent.length === n + 1 ? bent : null
    return Array.from({ length: i === 0 ? n + 1 : n }, (_, j) => {
      const k = i === 0 ? j : j + 1
      const t = k / n
      const lon = along ? along[k]!.lon : a.item.lon + (b.item.lon - a.item.lon) * t
      const lat = along ? along[k]!.lat : a.item.lat + (b.item.lat - a.item.lat) * t
      const g = ground(lon, lat)
      const z = ter ? g + a.item.alt + (b.item.alt - a.item.alt) * t : a.amsl + (b.amsl - a.amsl) * t
      return { d: a.d + (b.d - a.d) * t, g, z }
    })
  })
}
