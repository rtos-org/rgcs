// Points of interest as Mission Planner's poi.txt (Utilities/POI.cs, checked 2026-10-20): one POI a
// line, `lat <tab> lon <tab> name`, CRLF; MP skips lines with fewer than three fields. Shared by the
// planner and the camera ROI. Pure: no I/O here.
import { z } from 'zod'

export interface Poi {
  readonly lat: number
  readonly lon: number
  readonly name: string
}

const MAX_POI = 500
const poisSchema = z.array(z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), name: z.string() })).min(1).max(MAX_POI)

/** A name on one line (MP splits on tabs and lines). */
const flat = (name: string) => name.replace(/[\t\r\n]+/g, ' ')

export function poiToText(pois: readonly Poi[]): string {
  return pois.map((p) => `${p.lat}\t${p.lon}\t${flat(p.name)}\r\n`).join('')
}

/** Throws when no line is a POI or a coordinate is out of range. */
export function parsePoiFile(text: string): Poi[] {
  const pois = text
    .split(/\r?\n/)
    .map((l) => l.split('\t'))
    .filter((c) => c.length >= 3 && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])) && c[0]!.trim() !== '')
    .map((c) => ({ lat: Number(c[0]), lon: Number(c[1]), name: c[2]!.trim() }))
  return poisSchema.parse(pois)
}
