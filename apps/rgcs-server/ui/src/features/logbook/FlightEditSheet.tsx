// Edit sheet for one flight record (様式 1 manual fields) with its squawks. A draft is edited
// in place; a confirmed flight's save creates a correction row (the server supersedes it).
import { useState } from 'react'
import type { Flight, FlightPatch, FlightSquawkInput } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconClose } from '../../shared/ui/icons'
import { addSquawk, patchFlight } from './api'
import { fromLocalInput, splitList, toLocalInput } from './format'
import { firstIssue, flightPatchSchema } from './schema'
import { SquawkForm } from './SquawkForm'

interface Draft {
  readonly pilot: string
  readonly pilot_license: string
  readonly takeoff: string
  readonly landed: string
  readonly takeoff_place: string
  readonly landing_place: string
  readonly purposes: readonly string[]
  readonly specific_flight: readonly string[]
  readonly summary: string
  readonly safety_notes: string
}

function draftOf(f: Flight): Draft {
  return {
    pilot: f.pilot,
    pilot_license: f.pilot_license,
    takeoff: toLocalInput(f.takeoff_at),
    landed: f.landed_at === null ? '' : toLocalInput(f.landed_at),
    takeoff_place: f.takeoff_place,
    landing_place: f.landing_place,
    purposes: f.purposes,
    specific_flight: f.specific_flight,
    summary: f.summary,
    safety_notes: f.safety_notes,
  }
}

function toggle(list: readonly string[], v: string): readonly string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

function patchOf(d: Draft): FlightPatch | string {
  const takeoff_at = fromLocalInput(d.takeoff)
  if (takeoff_at === null) return 'takeoff_at'
  const landed_at = d.landed === '' ? null : fromLocalInput(d.landed)
  if (d.landed !== '' && landed_at === null) return 'landed_at'
  const base: FlightPatch = {
    pilot: d.pilot,
    pilot_license: d.pilot_license,
    takeoff_at,
    takeoff_place: d.takeoff_place,
    landing_place: d.landing_place,
    purposes: [...d.purposes],
    specific_flight: [...d.specific_flight],
    summary: d.summary,
    safety_notes: d.safety_notes,
  }
  const patch: FlightPatch = landed_at === null ? base : { ...base, landed_at }
  const issue = firstIssue(flightPatchSchema.safeParse(patch))
  return issue ? `${issue.path}: ${issue.message}` : patch
}

interface CheckListProps {
  readonly options: readonly string[]
  readonly value: readonly string[]
  readonly onChange: (next: readonly string[]) => void
}

function CheckList({ options, value, onChange }: CheckListProps) {
  return (
    <div className="row wrap">
      {options.map((o) => (
        <label key={o} className="lb-check">
          <input type="checkbox" checked={value.includes(o)} onChange={() => onChange(toggle(value, o))} />
          {o}
        </label>
      ))}
    </div>
  )
}

interface Props {
  readonly sysid: number
  readonly flight: Flight
  readonly dict: Dict
  readonly onClose: () => void
  /** The flight as the server returned it (a correction row has a new id). */
  readonly onSaved: (f: Flight) => void
}

export function FlightEditSheet({ sysid, flight, dict, onClose, onSaved }: Props) {
  const [current, setCurrent] = useState(flight)
  const [draft, setDraft] = useState<Draft>(() => draftOf(flight))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const confirmed = current.status === 'confirmed'

  const save = async (status?: 'confirmed') => {
    const built = patchOf(draft)
    if (typeof built === 'string') return setError(built)
    setBusy(true)
    setError(null)
    try {
      const saved = await patchFlight(sysid, current.id, status ? { ...built, status } : built)
      setCurrent(saved)
      setDraft(draftOf(saved))
      onSaved(saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const add = async (input: FlightSquawkInput) => {
    setBusy(true)
    try {
      const s = await addSquawk(sysid, current.id, input)
      const next = { ...current, squawks: [...current.squawks, s] }
      setCurrent(next)
      onSaved(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="g-strong panel sheet settings lb-sheet" role="dialog" aria-label={dict.lbSubFlights}>
      <div className="panel-h">
        <span className="h1">{dict.lbSubFlights}</span>
        <span className={`badge ${current.status}`}>{confirmed ? dict.lbConfirmed : dict.lbDraft}</span>
        <span className="grow" />
        <button type="button" className="btn-icon" aria-label={dict.close} title={dict.close} onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="lb-body">
        {confirmed && <div className="t3">{dict.lbConfirmedEditNote}</div>}
        <div className="lb-form">
          <label htmlFor="fl-pilot">{dict.lbPilot}</label>
          <input id="fl-pilot" className="in" value={draft.pilot} onChange={(e) => set({ pilot: e.target.value })} />
          <label htmlFor="fl-license">{dict.lbLicense}</label>
          <input id="fl-license" className="in" value={draft.pilot_license} onChange={(e) => set({ pilot_license: e.target.value })} />
          <span>{dict.lbPurpose}</span>
          <CheckList options={splitList(dict.lbPurposes)} value={draft.purposes} onChange={(purposes) => set({ purposes })} />
          <span>{dict.lbSpecific}</span>
          <CheckList options={splitList(dict.lbSpecificForms)} value={draft.specific_flight} onChange={(specific_flight) => set({ specific_flight })} />
          <label htmlFor="fl-summary">{dict.lbSummary}</label>
          <textarea id="fl-summary" className="in" value={draft.summary} onChange={(e) => set({ summary: e.target.value })} />
          <label htmlFor="fl-from">{dict.lbFrom}</label>
          <input id="fl-from" className="in" value={draft.takeoff_place} onChange={(e) => set({ takeoff_place: e.target.value })} />
          <label htmlFor="fl-to">{dict.lbTo}</label>
          <input id="fl-to" className="in" value={draft.landing_place} onChange={(e) => set({ landing_place: e.target.value })} />
          <label htmlFor="fl-off">{dict.lbOffTime}</label>
          <input id="fl-off" className="in" type="datetime-local" value={draft.takeoff} onChange={(e) => set({ takeoff: e.target.value })} />
          <label htmlFor="fl-on">{dict.lbOnTime}</label>
          <input id="fl-on" className="in" type="datetime-local" value={draft.landed} onChange={(e) => set({ landed: e.target.value })} />
          <label htmlFor="fl-safety">{dict.lbSafety}</label>
          <textarea id="fl-safety" className="in" value={draft.safety_notes} onChange={(e) => set({ safety_notes: e.target.value })} />
        </div>
        {error && <div className="warnbox fatal">{error}</div>}
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
            {dict.lbSave}
          </button>
          {!confirmed && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save('confirmed')}>
              {dict.lbConfirm}
            </button>
          )}
        </div>
        <div className="h2">{dict.lbSquawks}</div>
        {current.squawks.length > 0 && (
          <table className="tbl">
            <tbody>
              {current.squawks.map((s) => (
                <tr key={s.id}>
                  <td className="num">{s.occurred_on}</td>
                  <td>{s.description}</td>
                  <td className="num">{s.action_on}</td>
                  <td>{s.action}</td>
                  <td>{s.confirmer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <SquawkForm dict={dict} busy={busy} onAdd={add} />
      </div>
    </aside>
  )
}
