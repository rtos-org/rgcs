import type { LatLon } from '../mission/geo'

export type KmlErrorCode = 'not_kml' | 'no_polygon' | 'bad_coordinates' | 'too_large'

export class KmlError extends Error {
  readonly code: KmlErrorCode
  constructor(code: KmlErrorCode) {
    super(code)
    this.name = 'KmlError'
    this.code = code
  }
}

export interface KmlPolygon {
  /** The placemark's name; null when it has none (the UI names it by its place in the file). */
  name: string | null
  ring: LatLon[]
}

export interface KmlResult {
  polygons: KmlPolygon[]
  holesIgnored: boolean
}

const NS = '*'

export const MAX_KML_CHARS = 5_000_000
export const MAX_RING_VERTICES = 10_000
export const MAX_POLYGONS = 50

const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

function parseVertex(tuple: string): LatLon {
  const fields = tuple.split(',')
  if (fields.length < 2 || fields.length > 3 || !fields.every((f) => DECIMAL.test(f))) {
    throw new KmlError('bad_coordinates')
  }
  const lon = Number(fields[0])
  const lat = Number(fields[1])
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) throw new KmlError('bad_coordinates')
  return { lat, lon }
}

function parseCoordinates(text: string): LatLon[] {
  const trimmed = text.trim()
  const tuples = trimmed === '' ? [] : trimmed.replace(/,\s+/g, ',').split(/\s+/)
  if (tuples.length > MAX_RING_VERTICES + 1) throw new KmlError('too_large')
  const ring = tuples.map(parseVertex)
  const first = ring[0]
  const last = ring[ring.length - 1]
  const closed = ring.length > 1 && first.lat === last.lat && first.lon === last.lon
  return closed ? ring.slice(0, -1) : ring
}

function outerRing(polygon: Element): LatLon[] {
  const outer = polygon.getElementsByTagNameNS(NS, 'outerBoundaryIs')[0]
  const coords = outer?.getElementsByTagNameNS(NS, 'coordinates')[0]
  return coords?.textContent ? parseCoordinates(coords.textContent) : []
}

function placemarkName(polygon: Element): string | null {
  const placemark = polygon.closest('Placemark') ?? findAncestor(polygon, 'Placemark')
  if (!placemark) return null
  const name = Array.from(placemark.children).find((c) => c.localName === 'name')
  return name?.textContent?.trim() || null
}

function findAncestor(el: Element, localName: string): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) if (p.localName === localName) return p
  return null
}

export function parseKmlPolygons(text: string): KmlResult {
  if (text.length > MAX_KML_CHARS) throw new KmlError('too_large')
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const root = doc.documentElement
  if (!root || doc.getElementsByTagName('parsererror').length > 0 || root.localName !== 'kml') {
    throw new KmlError('not_kml')
  }
  const nodes = Array.from(doc.getElementsByTagNameNS(NS, 'Polygon'))
  if (nodes.length > MAX_POLYGONS) throw new KmlError('too_large')
  const polygons: KmlPolygon[] = []
  let holesIgnored = false
  nodes.forEach((polygon) => {
    const ring = outerRing(polygon)
    if (ring.length < 3) return
    if (polygon.getElementsByTagNameNS(NS, 'innerBoundaryIs').length > 0) holesIgnored = true
    polygons.push({ name: placemarkName(polygon), ring })
  })
  if (polygons.length === 0) throw new KmlError('no_polygon')
  return { polygons, holesIgnored }
}
