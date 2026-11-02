// 飛行記録 sub-tab: the vehicle's flights in the period, with edit / confirm / delete.
import { useEffect, useState } from 'react'
import type { Flight } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { deleteFlight, listFlights } from './api'
import { FlightEditSheet } from './FlightEditSheet'
import { jstDate, jstTime, minutesText, replaceFlight } from './format'

interface Props {
  readonly sysid: number
  readonly from: string
  readonly to: string
  readonly dict: Dict
  /** The latest `flight_draft_created` for this vehicle; a new id reloads the list. */
  readonly draft: Flight | undefined
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function FlightsPane({ sysid, from, to, dict, draft }: Props) {
  const draftId = draft?.id ?? null
  const [rows, setRows] = useState<readonly Flight[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Flight | null>(null)
  const [seenDraft, setSeenDraft] = useState<number | null>(draftId)
  const [banner, setBanner] = useState(false)
  if (draftId !== seenDraft) {
    setSeenDraft(draftId)
    setBanner(draftId !== null)
  }

  useEffect(() => {
    let live = true
    listFlights(sysid, from, to)
      .then((f) => live && setRows(f))
      .catch((e: unknown) => live && setError(message(e)))
    return () => {
      live = false
    }
  }, [sysid, from, to, draftId])

  const remove = async (id: number) => {
    try {
      await deleteFlight(sysid, id)
      setRows((r) => (r ?? []).filter((f) => f.id !== id))
    } catch (e) {
      setError(message(e))
    }
  }

  return (
    <div className="surface">
      <div className="row hair lb-head">
        <span className="h2">{dict.lbSubFlights}</span>
      </div>
      <div className="lb-table">
        {banner && <div className="warnbox">{dict.lbDraftCreated}</div>}
        {error && <div className="warnbox fatal">{error}</div>}
        {rows !== null && rows.length === 0 && <div className="t3 lb-empty">{dict.lbNoFlights}</div>}
        {rows !== null && rows.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th>{dict.lbFlightDate}</th>
                <th>{dict.lbOffTime}</th>
                <th>{dict.lbOnTime}</th>
                <th>{dict.lbFlightTime}</th>
                <th>{dict.lbTotalTime}</th>
                <th>{dict.lbPilot}</th>
                <th>{dict.lbPurpose}</th>
                <th>{dict.lbStatus}</th>
                <th>{dict.lbSquawks}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} data-testid="flight-row">
                  <td className="num">{jstDate(f.takeoff_at)}</td>
                  <td className="num">{jstTime(f.takeoff_at)}</td>
                  <td className="num">{f.landed_at === null ? '' : jstTime(f.landed_at)}</td>
                  <td className="num">{minutesText(f.flight_minutes, dict)}</td>
                  <td className="num">{minutesText(f.total_minutes, dict)}</td>
                  <td>{f.pilot}</td>
                  <td>{f.purposes.join('、')}</td>
                  <td>
                    <span className={`badge ${f.status}`}>{f.status === 'confirmed' ? dict.lbConfirmed : dict.lbDraft}</span>
                  </td>
                  <td className="num">{f.squawks.length}</td>
                  <td>
                    <div className="lb-inline-actions">
                      <button type="button" className="btn sm" onClick={() => setEditing(f)}>
                        {dict.lbEdit}
                      </button>
                      {f.status === 'draft' && (
                        <button type="button" className="btn btn-ghost sm" onClick={() => void remove(f.id)}>
                          {dict.lbDelete}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <FlightEditSheet
          key={editing.id}
          sysid={sysid}
          flight={editing}
          dict={dict}
          onClose={() => setEditing(null)}
          onSaved={(saved) => setRows((r) => replaceFlight(r ?? [], saved))}
        />
      )}
    </div>
  )
}
