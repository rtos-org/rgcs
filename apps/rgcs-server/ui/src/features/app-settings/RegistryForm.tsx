// 機体台帳 (無人航空機の概要) for the selected vehicle. Admins save; operators
// see the values read-only.
import { useEffect, useState } from 'react'
import type { InspectionTemplate, VehicleRegistry, VehicleRegistryInput, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { getRegistry, listTemplates, putRegistry } from '../logbook/api'
import { minutesText } from '../logbook/format'
import { firstIssue, registrySchema } from '../logbook/schema'

interface Props {
  readonly sysid: number
  readonly vehicle: VehicleState | undefined
  readonly isAdmin: boolean
  readonly dict: Dict
}

type Field = Exclude<keyof VehicleRegistryInput, 'initial_flight_minutes' | 'inspection_template_id' | 'endurance_minutes'>

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function inputOf(r: VehicleRegistry): VehicleRegistryInput {
  const { sysid: _s, total_flight_minutes: _t, ...input } = r
  return input
}

export function RegistryForm({ sysid, vehicle, isAdmin, dict }: Props) {
  const [draft, setDraft] = useState<VehicleRegistryInput | null>(null)
  const [total, setTotal] = useState(0)
  const [templates, setTemplates] = useState<readonly InspectionTemplate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    getRegistry(sysid)
      .then((r) => {
        if (!live) return
        setDraft(inputOf(r))
        setTotal(r.total_flight_minutes)
      })
      .catch((e: unknown) => live && setError(message(e)))
    listTemplates()
      .then((t) => live && setTemplates(t))
      .catch((e: unknown) => live && setError(message(e)))
    return () => {
      live = false
    }
  }, [sysid])

  const set = (patch: Partial<VehicleRegistryInput>) => {
    setSaved(false)
    setDraft((d) => (d ? { ...d, ...patch } : d))
  }

  const save = async () => {
    if (!draft) return
    const issue = firstIssue(registrySchema.safeParse(draft))
    if (issue) return setError(`${issue.path}: ${issue.message}`)
    setBusy(true)
    setError(null)
    try {
      const r = await putRegistry(sysid, draft)
      setDraft(inputOf(r))
      setTotal(r.total_flight_minutes)
      setSaved(true)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const fields: readonly { key: Field; label: string }[] = [
    { key: 'name', label: dict.lbVehicleName },
    { key: 'registration', label: dict.lbRegistration },
    { key: 'uas_type', label: dict.lbUasType },
    { key: 'model', label: dict.lbModel },
    { key: 'type_cert_no', label: dict.lbTypeCert },
    { key: 'airworthiness_class', label: dict.lbAwClass },
    { key: 'airworthiness_no', label: dict.lbAwNo },
    { key: 'manufacturer', label: dict.lbManufacturer },
    { key: 'serial_no', label: dict.lbSerial },
  ]
  return (
    <div className="surface" data-testid="registry-card">
      <div className="h1">{`${dict.lbRegistry} · ${vehicle?.name ?? `UAV-${String(sysid).padStart(2, '0')}`}`}</div>
      {!isAdmin && <div className="t3">{dict.lbAdminOnly}</div>}
      {draft && (
        <div className="lb-form">
          {fields.map((f) => (
            <FieldRow key={f.key} id={`reg-${f.key}`} label={f.label} value={draft[f.key]} disabled={!isAdmin} onChange={(v) => set({ [f.key]: v })} />
          ))}
          <label htmlFor="reg-initial">{dict.lbInitialMinutes}</label>
          <input id="reg-initial" className="in" type="number" min={0} value={draft.initial_flight_minutes} disabled={!isAdmin} onChange={(e) => set({ initial_flight_minutes: Number(e.target.value) })} />
          <label htmlFor="reg-endurance">{dict.regEndurance}</label>
          <input id="reg-endurance" className="in" type="number" min={0} value={draft.endurance_minutes ?? ''} disabled={!isAdmin} onChange={(e) => set({ endurance_minutes: e.target.value === '' ? null : Number(e.target.value) })} />
          <span />
          <span className="t3">{dict.regEnduranceNote}</span>
          <label htmlFor="reg-template">{dict.lbTemplateForVehicle}</label>
          <select id="reg-template" className="in" value={draft.inspection_template_id ?? ''} disabled={!isAdmin} onChange={(e) => set({ inspection_template_id: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">{dict.lbNoFlight}</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <span>{dict.lbTotalTime}</span>
          <span className="num">{minutesText(total, dict)}</span>
        </div>
      )}
      {error && <div className="warnbox fatal">{error}</div>}
      {saved && <div className="warnbox">{dict.lbSaved}</div>}
      {isAdmin && (
        <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy || !draft} onClick={() => void save()}>
          {dict.lbSave}
        </button>
      )}
    </div>
  )
}

function FieldRow({ id, label, value, disabled, onChange }: { id: string; label: string; value: string; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input id={id} className="in" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </>
  )
}
