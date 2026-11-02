// Fence / rally files for the planner (user request 2026-10-20: interchangeable with Mission
// Planner). Written exactly as MP's FlightPlanner saves them (QGC WPL 110, home row first,
// MAV_CMD_NAV_FENCE_* / MAV_CMD_NAV_RALLY_POINT); read from that, MP's older `.fen` / `.ral`, or a
// QGroundControl `.plan`. Checked against MissionPlanner master 2026-10-20. Pure: no I/O here.
import { z } from 'zod'
import type { FenceZone, Home, RallyPoint } from '../../shared/api/types'

const POLY_INC = 5001
const POLY_EXC = 5002
const CIRCLE_INC = 5003
const CIRCLE_EXC = 5004
const RALLY = 5100
const FRAME_REL = 3
const MAX_ZONES = 100
const MAX_RALLY = 100

const lat = z.number().min(-90).max(90)
const lon = z.number().min(-180).max(180)
const zoneSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('polygon'), inclusion: z.boolean(), vertices: z.array(z.object({ lat, lon })).min(1).max(255) }),
  z.object({ kind: z.literal('circle'), inclusion: z.boolean(), center: z.object({ lat, lon }), radius: z.number().positive() }),
])
const zonesSchema = z.array(zoneSchema).min(1).max(MAX_ZONES)
const rallySchema = z.array(z.object({ lat, lon, alt: z.number() })).min(1).max(MAX_RALLY)

const f8 = (n: number) => n.toFixed(8)
// Mission Planner's FlightPlanner.savewaypoints, byte for byte: items from seq 1 with 8-decimal
// params / lat / lon and a 6-decimal altitude.
const line = (seq: number, cmd: number, p1: number, la: number, lo: number, alt: number) =>
  [seq, 0, FRAME_REL, cmd, f8(p1), f8(0), f8(0), f8(0), f8(la), f8(lo), alt.toFixed(6), 1].join('\t')

/**
 * Line 0 is the home (7-decimal lat / lon, as MP writes it): MP drops line 0 when it loads a fence
 * or rally file, so without it the first vertex would be lost. No home: MP's own placeholder.
 */
function homeRow(home: Home | null): string {
  if (!home) return '0\t1\t0\t0\t0\t0\t0\t0\t0\t0\t0\t1'
  return ['0', '1', '0', '16', '0', '0', '0', '0', home.lat.toFixed(7), home.lon.toFixed(7), home.alt.toFixed(6), '1'].join('\t')
}

const wpl = (home: Home | null, rows: readonly string[]) => ['QGC WPL 110', homeRow(home), ...rows, ''].join('\r\n')

export function fenceToWpl(zones: readonly FenceZone[], home: Home | null): string {
  const rows: string[] = []
  for (const zn of zones) {
    if (zn.kind === 'polygon') zn.vertices.forEach((v) => rows.push(line(rows.length + 1, zn.inclusion ? POLY_INC : POLY_EXC, zn.vertices.length, v.lat, v.lon, 0)))
    else rows.push(line(rows.length + 1, zn.inclusion ? CIRCLE_INC : CIRCLE_EXC, zn.radius, zn.center.lat, zn.center.lon, 0))
  }
  return wpl(home, rows)
}

export function rallyToWpl(points: readonly RallyPoint[], home: Home | null): string {
  return wpl(home, points.map((r, i) => line(i + 1, RALLY, 0, r.lat, r.lon, r.alt)))
}

interface Row {
  readonly cmd: number
  readonly p1: number
  readonly lat: number
  readonly lon: number
  readonly alt: number
}

function wplRows(text: string): Row[] | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines[0]?.startsWith('QGC WPL')) return null
  return lines.slice(1).map((l) => {
    const c = l.split(/\s+/).map(Number)
    return { cmd: c[3]!, p1: c[4]!, lat: c[8]!, lon: c[9]!, alt: c[10]! }
  })
}

function wplZones(rows: readonly Row[]): FenceZone[] {
  const zones: FenceZone[] = []
  for (let i = 0; i < rows.length; ) {
    const r = rows[i]!
    if (r.cmd === CIRCLE_INC || r.cmd === CIRCLE_EXC) {
      zones.push({ kind: 'circle', inclusion: r.cmd === CIRCLE_INC, center: { lat: r.lat, lon: r.lon }, radius: r.p1 })
      i++
    } else if (r.cmd === POLY_INC || r.cmd === POLY_EXC) {
      // param1 is the polygon's vertex count: it separates adjacent polygons of one kind
      const n = Math.max(1, Math.round(r.p1))
      const run = rows.slice(i, i + n).filter((x) => x.cmd === r.cmd)
      zones.push({ kind: 'polygon', inclusion: r.cmd === POLY_INC, vertices: run.map((x) => ({ lat: x.lat, lon: x.lon })) })
      i += run.length
    } else i++
  }
  return zones
}

const planSchema = z.object({
  geoFence: z
    .object({
      polygons: z.array(z.object({ inclusion: z.boolean(), polygon: z.array(z.tuple([z.number(), z.number()])) })).default([]),
      circles: z.array(z.object({ inclusion: z.boolean(), circle: z.object({ center: z.tuple([z.number(), z.number()]), radius: z.number() }) })).default([]),
    })
    .optional(),
  rallyPoints: z.object({ points: z.array(z.array(z.number()).min(3)) }).optional(),
})

function readPlan(text: string): z.infer<typeof planSchema> | null {
  if (!text.trimStart().startsWith('{')) return null
  return planSchema.parse(JSON.parse(text))
}

/** Data lines of MP's older text files (`#` comments and blanks dropped), split on white space. */
const dataLines = (text: string): string[][] =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/\s+/))

/** MP's `.fen`: the return point, then one inclusion polygon closed on its first vertex. */
function fenZones(text: string): FenceZone[] | null {
  const pts = dataLines(text).map((c) => (c.length === 2 ? { lat: Number(c[0]), lon: Number(c[1]) } : null))
  if (pts.length < 2 || pts.some((p) => p === null || !Number.isFinite(p.lat) || !Number.isFinite(p.lon))) return null
  const ring = (pts as { lat: number; lon: number }[]).slice(1)
  const last = ring[ring.length - 1]!
  const closed = ring.length > 1 && last.lat === ring[0]!.lat && last.lon === ring[0]!.lon
  return [{ kind: 'polygon', inclusion: true, vertices: closed ? ring.slice(0, -1) : ring }]
}

/** The fence zones in a WPL, `.plan` or MP `.fen` file; throws when there are none or the file is malformed. */
export function parseFenceFile(text: string): FenceZone[] {
  const rows = wplRows(text)
  if (rows) return zonesSchema.parse(wplZones(rows))
  const plan = readPlan(text)
  if (!plan) {
    const fen = fenZones(text)
    if (fen) return zonesSchema.parse(fen)
    throw new Error('not a fence file')
  }
  const g = plan.geoFence
  const zones: FenceZone[] = [
    ...(g?.polygons ?? []).map((p) => ({ kind: 'polygon' as const, inclusion: p.inclusion, vertices: p.polygon.map(([la, lo]) => ({ lat: la, lon: lo })) })),
    ...(g?.circles ?? []).map((c) => ({ kind: 'circle' as const, inclusion: c.inclusion, center: { lat: c.circle.center[0], lon: c.circle.center[1] }, radius: c.circle.radius })),
  ]
  return zonesSchema.parse(zones)
}

/** The rally points in a WPL, `.plan` or MP `.ral` file; throws when there are none or the file is malformed. */
export function parseRallyFile(text: string): RallyPoint[] {
  const rows = wplRows(text)
  if (rows) return rallySchema.parse(rows.filter((r) => r.cmd === RALLY).map((r) => ({ lat: r.lat, lon: r.lon, alt: r.alt })))
  const plan = readPlan(text)
  if (!plan) {
    // MP `.ral`: RALLY <lat> <lon> <loiter alt> <break alt> <land heading> <flags>
    const ral = dataLines(text).filter((c) => c[0] === 'RALLY')
    if (ral.length) return rallySchema.parse(ral.map((c) => ({ lat: Number(c[1]), lon: Number(c[2]), alt: Number(c[3]) })))
    throw new Error('not a rally file')
  }
  return rallySchema.parse((plan.rallyPoints?.points ?? []).map((p) => ({ lat: p[0]!, lon: p[1]!, alt: p[2]! })))
}

const EARTH_R = 6_371_000

/** What to frame on the map for a fence: polygon vertices and each circle's north / south extent. */
export function fencePoints(zones: readonly FenceZone[]): { lat: number; lon: number }[] {
  return zones.flatMap((zn) => {
    if (zn.kind === 'polygon') return zn.vertices
    const dLat = (zn.radius / EARTH_R) * (180 / Math.PI)
    return [
      { lat: zn.center.lat - dLat, lon: zn.center.lon },
      { lat: zn.center.lat + dLat, lon: zn.center.lon },
    ]
  })
}
