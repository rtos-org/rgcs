// Labels and values for the 外的要因 chip. Every displayed value
// keeps its source and time (Review Focus 5).
import type { EnvFactor, EnvLevel, EnvReading, EnvSummary } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'

const lookup = (dict: Dict, key: string): string | undefined => (dict as Record<string, string | undefined>)[key]

const RANK: Readonly<Record<EnvLevel, number>> = { ok: 0, warn: 1, strong: 2 }

/** The factor with the highest level (the first one on ties); null when there is none. */
export function worstFactor(s: EnvSummary): EnvFactor | null {
  return s.factors.reduce<EnvFactor | null>((acc, f) => (acc === null || RANK[f.level] > RANK[acc.level] ? f : acc), null)
}

export function kindLabel(f: EnvFactor, dict: Dict, r: EnvReading | null = f.value ?? f.primary): string {
  if (f.kind === 'gnss' && (r?.note === 'sats' || r?.note === 'hdop')) return r.note === 'sats' ? dict.envF_sats : dict.envF_hdop
  return lookup(dict, `envK_${f.kind}`) ?? f.kind
}

export function valueText(f: EnvFactor, r: EnvReading, dict: Dict): string {
  if (f.kind === 'daylight') return `${Math.round(r.value)} ${dict.envUnitMin}`
  if (f.kind === 'gnss') return r.note === 'sats' ? String(Math.round(r.value)) : r.value.toFixed(1)
  const n = r.value.toFixed(1)
  if (f.unit === '') return n
  return f.unit.startsWith('°') ? `${n}${f.unit}` : `${n} ${f.unit}`
}

/** 「Kp 7.3」: the chip's short label for a factor. */
export function factorShort(f: EnvFactor, dict: Dict): string {
  const r = f.value ?? f.primary
  return r ? `${kindLabel(f, dict, r)} ${valueText(f, r, dict)}` : kindLabel(f, dict)
}

export function sourceLabel(source: string, dict: Dict): string {
  return lookup(dict, `envSrc_${source}`) ?? source
}

export function classLabel(r: EnvReading, dict: Dict): string {
  return lookup(dict, `envC_${r.class}`) ?? r.class
}

/** A reading note worth showing (JMA attribution + station); the GNSS sats / hdop markers are not. */
export function readingNote(r: EnvReading): string | null {
  return r.note === null || r.note === 'sats' || r.note === 'hdop' ? null : r.note
}

/** The newest reading time in the summary, else the summary's own time. */
export function lastSeen(s: EnvSummary): number {
  return s.factors.flatMap((f) => f.readings).reduce((acc, r) => Math.max(acc, r.at_ms), 0) || s.ts
}
