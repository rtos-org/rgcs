import { describe, expect, it } from 'vitest'
import { parsePoiFile, poiToText } from './poiFile'

describe('POI files (Mission Planner poi.txt: lat <tab> lon <tab> name, CRLF)', () => {
  it('writes what Mission Planner writes and reads it back', () => {
    const pois = [{ lat: 36.2509, lon: 137.6385, name: '河童橋' }, { lat: 35.0145, lon: 138.5302, name: 'Miho' }]
    const text = poiToText(pois)
    expect(text).toBe('36.2509\t137.6385\t河童橋\r\n35.0145\t138.5302\tMiho\r\n')
    expect(parsePoiFile(text)).toEqual(pois)
  })

  it('skips short lines like Mission Planner; tabs and line breaks in a name are made spaces', () => {
    expect(parsePoiFile('36.1\t137.1\n36.2\t137.2\tA\n')).toEqual([{ lat: 36.2, lon: 137.2, name: 'A' }])
    expect(poiToText([{ lat: 1, lon: 2, name: 'a\tb\nc' }])).toBe('1\t2\ta b c\r\n')
  })

  it('rejects coordinates out of range and files with no POI', () => {
    expect(() => parsePoiFile('95\t137\tX\n')).toThrow()
    expect(() => parsePoiFile('hello\n')).toThrow()
  })
})
