// Name / description search over the cached list: prefix of the name first,
// then name contains, then display name / description contains. Pure and allocation-light so
// it can run on every keystroke over ~1,200 entries.
import type { ParamEntry } from '../../shared/api/types'
import type { MetaMap, ParamMeta } from './meta'

export interface ParamRow {
  readonly name: string
  readonly value: number
  readonly index: number
  readonly ptype: number
  readonly meta?: ParamMeta
}

const tier = (row: ParamRow, q: string): number => {
  const name = row.name.toLowerCase()
  if (name.startsWith(q)) return 0
  if (name.includes(q)) return 1
  const m = row.meta
  if (m && (m.n.toLowerCase().includes(q) || m.d.toLowerCase().includes(q))) return 2
  return 3
}

/** Rows matching `query` (trimmed, case-insensitive); empty query → everything in name order. */
export function rank(entries: readonly ParamEntry[], meta: MetaMap, query: string): ParamRow[] {
  const rows: ParamRow[] = entries.map((e) => ({ ...e, meta: meta[e.name] }))
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const q = query.trim().toLowerCase()
  if (q === '') return rows
  return rows
    .map((row) => ({ row, tier: tier(row, q) }))
    .filter((x) => x.tier < 3)
    .sort((a, b) => a.tier - b.tier)
    .map((x) => x.row)
}
