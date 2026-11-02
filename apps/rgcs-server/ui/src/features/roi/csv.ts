// ROI preset CSV import: "名前,lat,lon,alt" (alt = MSL metres).
// Port of siyi-mt11-cameracontrol app/static/roi_csv.js; errors are codes the UI translates.
import type { RoiTarget } from '../../shared/api/types'

export const ROI_SLOT_COUNT = 10
const NAME_MAX = 64

export type CsvErrorCode = 'columns' | 'name_long' | 'lat' | 'lon' | 'alt'
export type CsvError = { readonly line: number; readonly code: CsvErrorCode } | { readonly line: 0; readonly code: 'empty' }

export interface CsvRow {
  readonly name: string
  readonly lat: number
  readonly lon: number
  readonly alt_msl: number
}

export interface CsvResult {
  readonly rows: CsvRow[]
  readonly errors: CsvError[]
  readonly skippedRows: number
}

/** UTF-8 (with or without BOM), falling back to Shift_JIS (Excel on Windows). */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('shift_jis').decode(bytes)
  }
}

/** One CSV line, honouring "quoted, fields" and "" escapes; fields are trimmed. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (quoted && c === '"' && line[i + 1] === '"') {
      cur += '"'
      i++
    } else if (c === '"') {
      quoted = !quoted
    } else if (c === ',' && !quoted) {
      fields.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  return [...fields, cur].map((f) => f.trim())
}

const toNumber = (text: string): number => (text === '' ? Number.NaN : Number(text))
const inRange = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi

function validateRow(fields: readonly string[]): CsvRow | CsvErrorCode {
  if (fields.length < 4) return 'columns'
  const [name, latText, lonText, altText] = fields as [string, string, string, string]
  const lat = toNumber(latText)
  const lon = toNumber(lonText)
  const alt = toNumber(altText)
  if (name.length > NAME_MAX) return 'name_long'
  if (!inRange(lat, -90, 90)) return 'lat'
  if (!inRange(lon, -180, 180)) return 'lon'
  if (!inRange(alt, -500, 9000)) return 'alt'
  return { name, lat, lon, alt_msl: alt }
}

const isHeader = (fields: readonly string[]) => Number.isNaN(toNumber(fields[1] ?? '')) && Number.isNaN(toNumber(fields[2] ?? ''))

/**
 * Parse ROI CSV text: the first `maxRows` data rows are validated, later ones are only counted.
 * A first non-blank line whose lat and lon are both non-numeric is a header.
 */
export function parseRoiCsv(text: string, maxRows: number = ROI_SLOT_COUNT): CsvResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const content = lines.flatMap((raw, index) => (raw.trim() === '' ? [] : [{ line: index + 1, fields: splitCsvLine(raw) }]))
  const data = content[0] && isHeader(content[0].fields) ? content.slice(1) : content
  const taken = data.slice(0, maxRows)
  const checked = taken.map(({ line, fields }) => ({ line, r: validateRow(fields) }))
  const rows = checked.flatMap(({ r }) => (typeof r === 'string' ? [] : [r]))
  const errors: CsvError[] = checked.flatMap(({ line, r }) => (typeof r === 'string' ? [{ line, code: r }] : []))
  if (rows.length === 0 && errors.length === 0) return { rows, errors: [{ line: 0, code: 'empty' }], skippedRows: 0 }
  return { rows, errors, skippedRows: data.length - taken.length }
}

/** Rows → roi_1..roi_N; slots without a row are emptied (the file is the full list). */
export function toRoiTargets(rows: readonly CsvRow[]): RoiTarget[] {
  return Array.from({ length: ROI_SLOT_COUNT }, (_, i) => {
    const r = rows[i]
    return r ? { id: `roi_${i + 1}`, name: r.name, lat: r.lat, lon: r.lon, alt_msl: r.alt_msl } : { id: `roi_${i + 1}`, name: '', lat: 0, lon: 0, alt_msl: 0 }
  })
}
