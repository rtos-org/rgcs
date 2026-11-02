// One inspection run (様式 2): the template's items with 正常 / 異常 / 未実施, place, date,
// inspector and notes. State is one immutable draft object; saving POSTs it and resets.
import { useState } from 'react'
import type { InspectionResult, InspectionRun, InspectionTemplate, MaintenanceInput, Operator, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { createInspection } from './api'
import { maintenanceDraftFor, placeText, todayJst } from './format'
import { firstIssue, inspectionRunSchemaFor } from './schema'

interface ItemDraft {
  readonly result: InspectionResult
  readonly remark: string
}

interface Draft {
  readonly items: readonly ItemDraft[]
  readonly place: string
  readonly lat: number | null
  readonly lon: number | null
  readonly performed_on: string
  readonly inspector: string
  readonly notes: string
}

const RESULTS: readonly InspectionResult[] = ['ok', 'ng', 'skipped']

function fresh(template: InspectionTemplate, me: Operator): Draft {
  return {
    items: template.items.map(() => ({ result: 'skipped', remark: '' })),
    place: '',
    lat: null,
    lon: null,
    performed_on: todayJst(),
    inspector: me.username,
    notes: '',
  }
}

/** The form prefilled from a saved run (訂正); item results carry over when the item count matches. */
function fromRun(template: InspectionTemplate, me: Operator, run: InspectionRun): Draft {
  const base = fresh(template, me)
  const sameItems = run.results.length === template.items.length
  return {
    ...base,
    items: sameItems ? run.results.map((r) => ({ result: r.result, remark: r.remark })) : base.items,
    place: run.place,
    lat: run.lat,
    lon: run.lon,
    performed_on: run.performed_on,
    inspector: run.inspector,
    notes: run.notes,
  }
}

function resultLabel(r: InspectionResult, dict: Dict): string {
  return r === 'ok' ? dict.lbResultOk : r === 'ng' ? dict.lbResultNg : dict.lbResultSkipped
}

interface ItemRowProps {
  readonly label: string
  readonly detail: string
  readonly draft: ItemDraft
  readonly dict: Dict
  readonly onChange: (next: ItemDraft) => void
}

function ItemRow({ label, detail, draft, dict, onChange }: ItemRowProps) {
  const idx = RESULTS.indexOf(draft.result)
  return (
    <tr data-testid="inspection-item">
      <td>{label}</td>
      <td className="lb-detail">{detail}</td>
      <td>
        <div className="seg n3">
          <span className="lens" style={{ transform: `translateX(${idx * 100}%)` }} />
          {RESULTS.map((r) => (
            <button key={r} type="button" className={r === draft.result ? 'on' : ''} onClick={() => onChange({ ...draft, result: r })}>
              {resultLabel(r, dict)}
            </button>
          ))}
        </div>
      </td>
      <td>
        <input className="in sm" value={draft.remark} placeholder={dict.lbRemark} onChange={(e) => onChange({ ...draft, remark: e.target.value })} />
      </td>
    </tr>
  )
}

interface Props {
  readonly template: InspectionTemplate
  readonly sysid: number
  readonly vehicle: VehicleState | undefined
  readonly me: Operator
  readonly dict: Dict
  readonly onSaved: (run: InspectionRun) => void
  readonly onMaintenanceDraft: (draft: MaintenanceInput) => void
  /** A saved run being corrected: the new run supersedes it. */
  readonly correcting?: InspectionRun | null
  readonly onCancelCorrection?: () => void
}

export function InspectionForm({ template, sysid, vehicle, me, dict, onSaved, onMaintenanceDraft, correcting = null, onCancelCorrection }: Props) {
  const [draft, setDraft] = useState<Draft>(() => (correcting ? fromRun(template, me, correcting) : fresh(template, me)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<InspectionRun | null>(null)
  const hasFix = vehicle !== undefined && vehicle.gps.fix >= 2
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  const save = async () => {
    const input = {
      template_id: template.id,
      place: draft.place,
      lat: draft.lat,
      lon: draft.lon,
      performed_on: draft.performed_on,
      inspector: draft.inspector,
      notes: draft.notes,
      results: draft.items.map((it, i) => ({ position: i + 1, result: it.result, remark: it.remark })),
      supersedes: correcting?.id ?? null,
    }
    const issue = firstIssue(inspectionRunSchemaFor(template.items.length).safeParse(input))
    if (issue) return setError(`${issue.path}: ${issue.message}`)
    setBusy(true)
    setError(null)
    try {
      const run = await createInspection(sysid, input)
      setSaved(run)
      setDraft(fresh(template, me))
      onSaved(run)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="surface lb-items">
      <div className="row hair lb-head">
        <span className="h2">{template.name}</span>
        <span className="lb-muted">v{template.version}</span>
        {correcting && (
          <>
            <span className="badge draft">{dict.lbCorrectingOf.replace('{date}', correcting.performed_on)}</span>
            <button type="button" className="btn btn-ghost sm" onClick={onCancelCorrection}>
              {dict.cancel}
            </button>
          </>
        )}
      </div>
      <div className="lb-body">
        <table className="tbl">
          <thead>
            <tr>
              <th>{dict.lbItem}</th>
              <th>{dict.lbDetail}</th>
              <th>{dict.lbResult}</th>
              <th>{dict.lbRemark}</th>
            </tr>
          </thead>
          <tbody>
            {template.items.map((item, i) => (
              <ItemRow key={i} label={item.label} detail={item.detail} draft={draft.items[i]} dict={dict} onChange={(next) => set({ items: draft.items.map((x, k) => (k === i ? next : x)) })} />
            ))}
          </tbody>
        </table>
        <div className="lb-form">
          <label htmlFor="insp-place">{dict.lbPlace}</label>
          <div className="row" style={{ gap: 8 }}>
            <input id="insp-place" className="in" value={draft.place} onChange={(e) => set({ place: e.target.value })} />
            <button type="button" className="btn sm" disabled={!hasFix} onClick={() => vehicle && set({ lat: vehicle.lat, lon: vehicle.lon })}>
              {dict.lbUseVehiclePosition}
            </button>
            {draft.lat !== null && <span className="lb-muted num">{placeText('', draft.lat, draft.lon)}</span>}
          </div>
          <label htmlFor="insp-date">{dict.lbDate}</label>
          <input id="insp-date" className="in" type="date" value={draft.performed_on} onChange={(e) => set({ performed_on: e.target.value })} />
          <label htmlFor="insp-inspector">{dict.lbInspector}</label>
          <input id="insp-inspector" className="in" value={draft.inspector} onChange={(e) => set({ inspector: e.target.value })} />
          <label htmlFor="insp-notes">{dict.lbNotes}</label>
          <textarea id="insp-notes" className="in" value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>
        {error && <div className="warnbox fatal">{error}</div>}
        {saved && (
          <div className="warnbox" data-testid="inspection-saved">
            <div>{dict.lbSaved}</div>
            {saved.has_ng && (
              <div className="row" style={{ gap: 10, marginTop: 6 }}>
                <span>{dict.lbNgHint}</span>
                <button type="button" className="btn sm" onClick={() => onMaintenanceDraft(maintenanceDraftFor(saved))}>
                  {dict.lbMakeMaintenanceDraft}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="lb-foot">
        <button type="button" className="btn btn-lg btn-primary" disabled={busy} onClick={() => void save()}>
          {dict.lbSave}
        </button>
      </div>
    </div>
  )
}
