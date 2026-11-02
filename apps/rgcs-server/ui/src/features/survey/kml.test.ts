/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KmlError, MAX_KML_CHARS, MAX_POLYGONS, MAX_RING_VERTICES, parseKmlPolygons, type KmlErrorCode } from './kml'

const fixture = (name: string): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../../../tests/fixtures/survey', name), 'utf8')
const areaKml = fixture('area.kml')
const twoKml = fixture('two-areas.kml')
const holeKml = fixture('hole.kml')
const notKml = fixture('not-kml.txt')

describe('parseKmlPolygons', () => {
  it('reads one ring, drops the closing vertex and keeps lon,lat order', () => {
    const { polygons, holesIgnored } = parseKmlPolygons(areaKml)
    expect(holesIgnored).toBe(false)
    expect(polygons).toHaveLength(1)
    expect(polygons[0].name).toBe('河原エリア')
    expect(polygons[0].ring).toHaveLength(5)
    expect(polygons[0].ring[0]).toEqual({ lat: 36.25, lon: 137.64 })
    expect(polygons[0].ring[2]).toEqual({ lat: 36.254, lon: 137.646 })
  })

  it('reads several placemarks; an unnamed one has no name (the UI names it)', () => {
    const { polygons } = parseKmlPolygons(twoKml)
    expect(polygons.map((p) => p.name)).toEqual(['北エリア', null])
    expect(polygons[1].ring).toHaveLength(4)
  })

  it('ignores holes and reports it', () => {
    const { polygons, holesIgnored } = parseKmlPolygons(holeKml)
    expect(holesIgnored).toBe(true)
    expect(polygons).toHaveLength(1)
    expect(polygons[0].ring).toHaveLength(4)
    expect(polygons[0].ring[0]).toEqual({ lat: 36.25, lon: 137.64 })
  })

  it('throws not_kml for text that is not KML', () => {
    expect(() => parseKmlPolygons(notKml)).toThrow(KmlError)
    try {
      parseKmlPolygons(notKml)
    } catch (e) {
      expect((e as KmlError).code).toBe('not_kml')
    }
  })

  it('throws no_polygon for a KML with only a LineString', () => {
    const line = `<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><LineString><coordinates>137.64,36.25,0 137.65,36.26,0</coordinates></LineString></Placemark></kml>`
    try {
      parseKmlPolygons(line)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(KmlError)
      expect((e as KmlError).code).toBe('no_polygon')
    }
  })

  const wrap = (coords: string): string =>
    `<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>`
  const codeOf = (text: string): KmlErrorCode | null => {
    try {
      parseKmlPolygons(text)
      return null
    } catch (e) {
      return e instanceof KmlError ? e.code : null
    }
  }

  it.each([',36.2', '137.6,', 'abc,36', 'NaN,36', '137.6,999', '200,36', 'Infinity,36', '0x10,36'])(
    'rejects bad vertex %s with bad_coordinates',
    (bad) => {
      expect(codeOf(wrap(`${bad} 137.64,36.25 137.65,36.26 137.66,36.25`))).toBe('bad_coordinates')
    },
  )

  it('accepts spaces around commas inside a tuple', () => {
    const { polygons } = parseKmlPolygons(wrap('137.64, 36.25, 10 137.65, 36.26,10 137.66,36.25,10'))
    expect(polygons[0].ring).toEqual([
      { lat: 36.25, lon: 137.64 },
      { lat: 36.26, lon: 137.65 },
      { lat: 36.25, lon: 137.66 },
    ])
  })

  it('rejects text longer than MAX_KML_CHARS with too_large', () => {
    expect(codeOf(' '.repeat(MAX_KML_CHARS + 1))).toBe('too_large')
  })

  it.each(['137.6,36.2 ,36.3 137.7,36.3 137.8,36.2', '137.6,36.2 , 36.3 137.7,36.3 137.8,36.2'])(
    'does not absorb a stray vertex as altitude: %s',
    (coords) => {
      expect(codeOf(wrap(coords))).toBe('bad_coordinates')
    },
  )

  it('rejects a bad vertex in the middle of a valid list', () => {
    expect(codeOf(wrap('137.6,36.2 137.7,36.3 abc,36 137.8,36.2'))).toBe('bad_coordinates')
  })

  const distinct = (n: number): string[] =>
    Array.from({ length: n }, (_, i) => `${(137 + i * 1e-5).toFixed(5)},36.25`)

  it('accepts exactly MAX_RING_VERTICES vertices plus the closing one, rejects one more', () => {
    const ok = distinct(MAX_RING_VERTICES)
    expect(parseKmlPolygons(wrap([...ok, ok[0]].join(' '))).polygons[0].ring).toHaveLength(MAX_RING_VERTICES)
    const over = distinct(MAX_RING_VERTICES + 1)
    expect(codeOf(wrap([...over, over[0]].join(' ')))).toBe('too_large')
  })

  it('rejects more than MAX_POLYGONS polygons', () => {
    const one = '<Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>137.6,36.2 137.7,36.2 137.7,36.3</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>'
    const many = (n: number): string => `<kml>${one.repeat(n)}</kml>`
    expect(parseKmlPolygons(many(MAX_POLYGONS)).polygons).toHaveLength(MAX_POLYGONS)
    expect(codeOf(many(MAX_POLYGONS + 1))).toBe('too_large')
  })
})
