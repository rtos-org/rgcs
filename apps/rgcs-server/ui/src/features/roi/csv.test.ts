import { describe, expect, it } from 'vitest'
import { decodeCsvBytes, parseRoiCsv, toRoiTargets } from './csv'

// 1:1 port of siyi-mt11-cameracontrol tests/js/roi_csv.test.mjs (error codes instead of prose).
describe('roi csv', () => {
  it('parses rows with a header line', () => {
    const r = parseRoiCsv('名前,lat,lon,alt\n東京タワー,35.6585805,139.7454329,150\n鉄塔,35.1,139.2,40.5\n')
    expect(r.errors).toEqual([])
    expect(r.skippedRows).toBe(0)
    expect(r.rows).toEqual([
      { name: '東京タワー', lat: 35.6585805, lon: 139.7454329, alt_msl: 150 },
      { name: '鉄塔', lat: 35.1, lon: 139.2, alt_msl: 40.5 },
    ])
  })

  it('works without a header, with CRLF, BOM, spaces and blank lines', () => {
    const r = parseRoiCsv('﻿ A , 35.0 , 139.0 , 10 \r\n\r\nB,35.1,139.1,20\r\n')
    expect(r.errors).toEqual([])
    expect(r.rows.map((x) => x.name)).toEqual(['A', 'B'])
  })

  it('quoted names may contain commas and quotes', () => {
    const r = parseRoiCsv('"Gate ""A"", north",36.1,139.1,400\n"Tower, north",35,139,10\n')
    expect(r.rows.map((x) => x.name)).toEqual(['Gate "A", north', 'Tower, north'])
  })

  it('uses only the first 10 data rows', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `P${i + 1},35.${i},139,0`).join('\n')
    const r = parseRoiCsv(lines)
    expect(r.rows).toHaveLength(10)
    expect(r.rows[9]?.name).toBe('P10')
    expect(r.skippedRows).toBe(2)
  })

  it('reports invalid rows with line numbers', () => {
    const r = parseRoiCsv('名前,lat,lon,alt\nA,35,139,0\nB,91,139,0\nC,35,abc,0\nD,35,139\nE,35,139,9001\n')
    expect(r.errors).toEqual([
      { line: 3, code: 'lat' },
      { line: 4, code: 'lon' },
      { line: 5, code: 'columns' },
      { line: 6, code: 'alt' },
    ])
  })

  it('rejects empty file and too long names', () => {
    expect(parseRoiCsv('名前,lat,lon,alt\n').errors).toEqual([{ line: 0, code: 'empty' }])
    expect(parseRoiCsv('').errors).toEqual([{ line: 0, code: 'empty' }])
    expect(parseRoiCsv(`${'x'.repeat(65)},35,139,0`).errors).toEqual([{ line: 1, code: 'name_long' }])
  })

  it('toRoiTargets fills roi_1..roi_N and clears the rest', () => {
    const targets = toRoiTargets([{ name: 'A', lat: 35, lon: 139, alt_msl: 10 }])
    expect(targets).toHaveLength(10)
    expect(targets[0]).toEqual({ id: 'roi_1', name: 'A', lat: 35, lon: 139, alt_msl: 10 })
    expect(targets[1]).toEqual({ id: 'roi_2', name: '', lat: 0, lon: 0, alt_msl: 0 })
    expect(targets[9]?.id).toBe('roi_10')
  })

  it('decodeCsvBytes: UTF-8 and Shift_JIS', () => {
    expect(decodeCsvBytes(new TextEncoder().encode('名前,lat'))).toBe('名前,lat')
    expect(decodeCsvBytes(new Uint8Array([0x96, 0xbc, 0x91, 0x4f, 0x2c, 0x6c, 0x61, 0x74]))).toBe('名前,lat')
    expect(decodeCsvBytes(new Uint8Array([145, 151, 147, 100, 147, 131]))).toBe('送電塔')
  })
})
