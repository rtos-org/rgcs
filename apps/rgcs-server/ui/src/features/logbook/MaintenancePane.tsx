// 点検整備記録 sub-tab (様式 3): the period's records and an inline entry form.
import { useEffect, useState } from 'react'
import type { MaintenanceInput, MaintenanceRecord } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { createMaintenance, listMaintenance } from './api'
import { minutesText, todayJst } from './format'
import { firstIssue, maintenanceSchema } from './schema'

const EMPTY: MaintenanceInput = { performed_on: '', detail: '', reason: '', place: '', engineer: '', notes: '', supersedes: null }

interface Props {
  readonly sysid: number
  readonly from: string
  readonly to: string
  readonly dict: Dict
  readonly engineer: string
  /** A draft handed over from 日常点検 (異常); identity change refills the form. */
  readonly prefill: MaintenanceInput | null
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function MaintenancePane({ sysid, from, to, dict, engineer, prefill }: Props) {
  const [rows, setRows] = useState<readonly MaintenanceRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<MaintenanceInput>(() => prefill ?? { ...EMPTY, performed_on: todayJst(), engineer })
  const [seen, setSeen] = useState(prefill)
  const [busy, setBusy] = useState(false)
  if (prefill !== seen) {
    setSeen(prefill)
    if (prefill) setDraft(prefill)
  }
  const set = (patch: Partial<MaintenanceInput>) => setDraft((d) => ({ ...d, ...patch }))

  useEffect(() => {
    let live = true
    listMaintenance(sysid, from, to)
      .then((r) => live && setRows(r))
      .catch((e: unknown) => live && setError(message(e)))
    return () => {
      live = false
    }
  }, [sysid, from, to])

  const save = async () => {
    const issue = firstIssue(maintenanceSchema.safeParse(draft))
    if (issue) return setError(`${issue.path}: ${issue.message}`)
    setBusy(true)
    setError(null)
    try {
      const rec = await createMaintenance(sysid, draft)
      setRows((r) => [...(r ?? []), rec])
      setDraft({ ...EMPTY, performed_on: todayJst(), engineer })
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="surface">
      <div className="row hair lb-head">
        <span className="h2">{dict.lbSubMaintenance}</span>
      </div>
      <div className="lb-body">
        <div className="lb-table">
          {rows !== null && rows.length === 0 && <div className="t3 lb-empty">{dict.lbNoMaintenance}</div>}
          {rows !== null && rows.length > 0 && (
            <table className="tbl">
              <thead>
                <tr>
                  <th>{dict.lbDate}</th>
                  <th>{dict.lbTotalTime}</th>
                  <th>{dict.lbMaintDetail}</th>
                  <th>{dict.lbReason}</th>
                  <th>{dict.lbPlace}</th>
                  <th>{dict.lbEngineer}</th>
                  <th>{dict.lbNotes}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid="maintenance-row">
                    <td className="num">{r.performed_on}</td>
                    <td className="num">{minutesText(r.total_minutes, dict)}</td>
                    <td>{r.detail}</td>
                    <td>{r.reason}</td>
                    <td>{r.place}</td>
                    <td>{r.engineer}</td>
                    <td>{r.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="lb-form">
          <label htmlFor="mt-date">{dict.lbDate}</label>
          <input id="mt-date" className="in" type="date" value={draft.performed_on} onChange={(e) => set({ performed_on: e.target.value })} />
          <label htmlFor="mt-detail">{dict.lbMaintDetail}</label>
          <textarea id="mt-detail" className="in" value={draft.detail} onChange={(e) => set({ detail: e.target.value })} />
          <label htmlFor="mt-reason">{dict.lbReason}</label>
          <input id="mt-reason" className="in" value={draft.reason} onChange={(e) => set({ reason: e.target.value })} />
          <label htmlFor="mt-place">{dict.lbPlace}</label>
          <input id="mt-place" className="in" value={draft.place} onChange={(e) => set({ place: e.target.value })} />
          <label htmlFor="mt-engineer">{dict.lbEngineer}</label>
          <input id="mt-engineer" className="in" value={draft.engineer} onChange={(e) => set({ engineer: e.target.value })} />
          <label htmlFor="mt-notes">{dict.lbNotes}</label>
          <input id="mt-notes" className="in" value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>
        {error && <div className="warnbox fatal">{error}</div>}
      </div>
      <div className="lb-foot">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {dict.lbAddMaintenance}
        </button>
      </div>
    </div>
  )
}
