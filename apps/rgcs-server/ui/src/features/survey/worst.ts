// Terrain worst case for a survey: the ground range under the polygon and what it does to the
// GSD and the overlaps when the survey is flown at a fixed altitude above home.
import type { ElevAt } from '../map/air'
import { fromLocal, toLocal, type Xy } from '../mission/arc'
import type { LatLon } from '../mission/geo'
import type { SurveyGeometry } from './generate'
import { footprint, gsdCm } from './photo'
import type { SurveySpec } from './spec'

export interface GroundRange {
  readonly min: number
  readonly max: number
}

export interface WorstCase {
  /** GSD at the highest AGL (lowest ground): the coarsest image. */
  readonly gsdCm: number
  /** GSD at the lowest AGL (highest ground): the most motion blur in pixels. */
  readonly minGsdCm: number
  /** Overlaps at the lowest AGL (highest ground), with the fixed trigger distance and lane spacing. */
  readonly frontPct: number
  readonly sidePct: number
  /** Clearance over the highest ground (flight AMSL − highest ground); negative = the ground is above. */
  readonly lowAglM: number
}

const MAX_SAMPLES = 2000
const MIN_STEP_M = 10
/** Overlap when the footprint shrinks to nothing (ground at or above the flight altitude). */
const NO_OVERLAP_PCT = -100

/** Even-odd ray cast. */
function inside(pts: readonly Xy[], p: Xy): boolean {
  let hit = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

/** Cell centres of a `step` grid over the ring's bounding box that fall inside the ring. */
function gridInside(pts: readonly Xy[], step: number): Xy[] {
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)]
  const nx = Math.ceil((Math.max(...xs) - x0) / step)
  const ny = Math.ceil((Math.max(...ys) - y0) / step)
  const cells = Array.from({ length: nx * ny }, (_, k) => ({ x: x0 + ((k % nx) + 0.5) * step, y: y0 + (Math.floor(k / nx) + 0.5) * step }))
  return cells.filter((c) => inside(pts, c))
}

/** The grid step whose cells over the bounding box number at most MAX_SAMPLES (≥ MIN_STEP_M). */
function boxStep(pts: readonly Xy[]): number {
  const w = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x))
  const h = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y))
  let step = Math.max(Math.sqrt((w * h) / MAX_SAMPLES), w / MAX_SAMPLES, h / MAX_SAMPLES, MIN_STEP_M)
  while (Math.ceil(w / step) * Math.ceil(h / step) > MAX_SAMPLES) step *= 1.01
  return step
}

/** Every k-th vertex, at most MAX_SAMPLES of them. */
const someVertices = (polygon: readonly LatLon[]): LatLon[] => polygon.filter((_, i) => i % Math.ceil(polygon.length / MAX_SAMPLES) === 0)

/**
 * Grid samples inside the polygon: at most MAX_SAMPLES (the grid is sized on the bounding box, so a
 * thin diagonal sliver never scans millions of cells); a sliver the grid misses samples its vertices.
 */
function samplePoints(polygon: readonly LatLon[]): LatLon[] {
  const origin = polygon[0]
  const pts = polygon.map((p) => toLocal(origin, p))
  const cells = gridInside(pts, boxStep(pts))
  return cells.length > 0 ? cells.map((c) => fromLocal(origin, c)) : someVertices(polygon)
}

/** Lowest and highest ground (AMSL) inside the polygon; null when no sample has data. */
export function groundRange(polygon: readonly LatLon[], elevAt: ElevAt): GroundRange | null {
  if (polygon.length < 3) return null
  const heights = samplePoints(polygon)
    .map((p) => elevAt(p.lon, p.lat))
    .filter((h): h is number => h !== null && Number.isFinite(h))
  if (heights.length === 0) return null
  return { min: Math.min(...heights), max: Math.max(...heights) }
}

const overlapPct = (stepM: number, coverM: number): number => (coverM > 0 ? Math.max(NO_OVERLAP_PCT, (1 - stepM / coverM) * 100) : NO_OVERLAP_PCT)

/** GSD and overlaps at the extremes of the ground range, flying `spec.altM` above home (`homeAmsl`). */
export function worstCase(spec: SurveySpec, geometry: SurveyGeometry, range: GroundRange, homeAmsl: number): WorstCase {
  const flightAmsl = homeAmsl + spec.altM
  const highAgl = flightAmsl - range.min
  const lowAgl = flightAmsl - range.max
  const fp = footprint(spec.camera, Math.max(lowAgl, 0), spec.orientation)
  return {
    gsdCm: gsdCm(spec.camera, highAgl),
    minGsdCm: gsdCm(spec.camera, Math.max(lowAgl, 0)),
    frontPct: overlapPct(geometry.triggerDistM, fp.alongM),
    sidePct: overlapPct(geometry.spacingM, fp.acrossM),
    lowAglM: lowAgl,
  }
}
