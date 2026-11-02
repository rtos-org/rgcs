// 判定の閾値 (fixed values: Thresholds): warn / strong per factor for コプター / クワッドプレーン / 固定翼.
// Admins edit and save the three tables in one PUT; operators read them.
import { useState } from 'react'
import { z } from 'zod'
import type { EnvSettings, EnvThresholds } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'

type Airframe = 'copter' | 'quadplane' | 'plane'
type Factor = keyof EnvThresholds
type Draft = Record<Airframe, Record<Factor, readonly [string, string]>>

const AIRFRAMES: readonly Airframe[] = ['copter', 'quadplane', 'plane']
const FACTORS: readonly Factor[] = ['wind', 'gust', 'precip', 'temp_low', 'temp_high', 'kp', 'declination', 'sats', 'hdop', 'sunset_min']
const UNITS: Record<Factor, string> = {
  wind: 'm/s', gust: 'm/s', precip: 'mm/h', temp_low: '°C', temp_high: '°C', kp: '', declination: '°', sats: '', hdop: '', sunset_min: 'min',
}

const pair = z.tuple([z.number().finite(), z.number().finite()])

interface Props {
  readonly settings: EnvSettings
  readonly isAdmin: boolean
  readonly dict: Dict
  readonly onSave: (tables: Pick<EnvSettings, Airframe>) => Promise<boolean>
}

function toDraft(s: EnvSettings): Draft {
  const one = (t: EnvThresholds) =>
    Object.fromEntries(FACTORS.map((f) => [f, [String(t[f][0]), String(t[f][1])] as const])) as Record<Factor, readonly [string, string]>
  return { copter: one(s.copter), quadplane: one(s.quadplane), plane: one(s.plane) }
}

/** The three tables as numbers, or null when any cell is not a finite number. */
export function parseDraft(d: Draft): Pick<EnvSettings, Airframe> | null {
  const one = (a: Airframe): EnvThresholds | null => {
    const entries = FACTORS.map((f) => [f, pair.safeParse(d[a][f].map((v) => (v.trim() === '' ? NaN : Number(v))))] as const)
    if (entries.some(([, r]) => !r.success)) return null
    return Object.fromEntries(entries.map(([f, r]) => [f, r.data])) as EnvThresholds
  }
  const [copter, quadplane, plane] = AIRFRAMES.map(one)
  return copter && quadplane && plane ? { copter, quadplane, plane } : null
}

export function ThresholdTable({ settings, isAdmin, dict, onSave }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [issue, setIssue] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const view = draft ?? toDraft(settings)
  const names: Record<Airframe, string> = { copter: dict.envCopter, quadplane: dict.envQuadplane, plane: dict.envPlane }
  const edit = (a: Airframe, f: Factor, i: 0 | 1, v: string) => {
    const cur = view[a][f]
    const next: readonly [string, string] = i === 0 ? [v, cur[1]] : [cur[0], v]
    setSaved(false)
    setDraft({ ...view, [a]: { ...view[a], [f]: next } })
  }
  const save = async () => {
    const parsed = parseDraft(view)
    if (!parsed) return setIssue(dict.envThresholdInvalid)
    setIssue(null)
    if (await onSave(parsed)) {
      setDraft(null)
      setSaved(true)
    }
  }
  return (
    <section className="inset env-thresholds" data-testid="env-thresholds">
      <div className="h2">{dict.envThresholds}</div>
      <div className="t3 env-note">{dict.envThresholdsNote}</div>
      <table className="tbl compact env-th-table">
        <thead>
          <tr>
            <th rowSpan={2} />
            {AIRFRAMES.map((a) => (
              <th key={a} colSpan={2} className="env-th-group">
                {names[a]}
              </th>
            ))}
            <th rowSpan={2} />
          </tr>
          <tr>
            {AIRFRAMES.flatMap((a) => [
              <th key={`${a}-w`}>{dict.envWarn}</th>,
              <th key={`${a}-s`}>{dict.envStrong}</th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {FACTORS.map((f) => (
            <FactorRow key={f} factor={f} label={dict[`envF_${f}`]} unit={f === 'sunset_min' ? dict.envUnitMin : UNITS[f]} view={view} names={names} dict={dict} disabled={!isAdmin} onEdit={edit} />
          ))}
        </tbody>
      </table>
      {isAdmin && (
        <div className="row env-th-actions">
          {issue && <span className="settings-issue">{issue}</span>}
          {saved && <span className="t3">{dict.guardSaved}</span>}
          <button type="button" className="btn btn-sm" disabled={draft === null} onClick={() => void save()}>
            {dict.envSaveThresholds}
          </button>
        </div>
      )}
    </section>
  )
}

interface RowProps {
  readonly factor: Factor
  readonly label: string
  readonly unit: string
  readonly view: Draft
  readonly names: Record<Airframe, string>
  readonly dict: Dict
  readonly disabled: boolean
  readonly onEdit: (a: Airframe, f: Factor, i: 0 | 1, v: string) => void
}

function FactorRow({ factor, label, unit, view, names, dict, disabled, onEdit }: RowProps) {
  return (
    <tr>
      <td className="env-th-name">{label}</td>
      {AIRFRAMES.flatMap((a) =>
        ([0, 1] as const).map((i) => (
          <td key={`${a}-${i}`}>
            <input
              type="number"
              step="any"
              className="in num env-th-in"
              aria-label={`${label} ${names[a]} ${i === 0 ? dict.envWarn : dict.envStrong}`}
              value={view[a][factor][i]}
              disabled={disabled}
              onChange={(e) => onEdit(a, factor, i, e.target.value)}
            />
          </td>
        )),
      )}
      <td className="t3 env-th-unit">{unit}</td>
    </tr>
  )
}
