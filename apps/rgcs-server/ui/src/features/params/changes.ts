// The change set: pending edits by name, kept immutable; helpers to format
// values through the metadata and to parse what the operator typed.
import type { ParamChange, ParamEntry } from '../../shared/api/types'
import type { MetaMap, ParamMeta } from './meta'

export type Changes = ReadonlyMap<string, number>
export const EMPTY_CHANGES: Changes = new Map()

/** Adds or replaces a change; a value equal to the current one removes it from the set. */
export function setChange(changes: Changes, name: string, value: number, entries?: ReadonlyMap<string, ParamEntry>): Changes {
  const current = entries?.get(name)?.value
  if (current !== undefined && current === value) return clearChange(changes, name)
  const next = new Map(changes)
  next.set(name, value)
  return next
}

export function clearChange(changes: Changes, name: string): Changes {
  if (!changes.has(name)) return changes
  const next = new Map(changes)
  next.delete(name)
  return next
}

/** The set as the wire body, in insertion order. */
export function pending(changes: Changes, _entries?: ReadonlyMap<string, ParamEntry>): ParamChange[] {
  return [...changes].map(([name, value]) => ({ name, value }))
}

/** Names in the set whose metadata says the vehicle must reboot. */
export function rebootNeeded(changes: Changes, meta: MetaMap): string[] {
  return [...changes.keys()].filter((name) => meta[name]?.reboot === true)
}

/** Float32-sized decimal (7 significant digits): 0.30000000000000004 → "0.3", 0.0004 stays 0.0004. */
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toPrecision(7)))
}

/** "Enabled (1)" for enumerated values, otherwise the plain number. */
export function formatValue(value: number, meta: ParamMeta | undefined): string {
  const label = meta?.v?.[String(value)]
  return label === undefined ? formatNumber(value) : `${label} (${formatNumber(value)})`
}

export type Parsed = { readonly ok: true; readonly value: number } | { readonly ok: false; readonly reason: 'nan' | 'range' }

/** Parses operator input; a value outside the metadata range is refused (ArduPilot would clamp silently). */
export function parseInput(text: string, meta: ParamMeta | undefined): Parsed {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: false, reason: 'nan' }
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return { ok: false, reason: 'nan' }
  if (meta?.r && (value < meta.r[0] || value > meta.r[1])) return { ok: false, reason: 'range' }
  return { ok: true, value }
}
