// 日常点検 tab: the vehicle's template on the left, saved runs on
// the right. Loads per vehicle; the parent keys it by sysid.
import { useEffect, useState } from 'react'
import type { InspectionRun, InspectionTemplate, MaintenanceInput, Operator, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { getVehicleTemplate, listInspections } from './api'
import { InspectionForm } from './InspectionForm'
import { InspectionsPane } from './InspectionsPane'

const RECENT = 20

interface Props {
  readonly sysid: number
  readonly vehicle: VehicleState | undefined
  readonly me: Operator
  readonly dict: Dict
  readonly onMaintenanceDraft: (draft: MaintenanceInput) => void
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function DailyTab({ sysid, vehicle, me, dict, onMaintenanceDraft }: Props) {
  const [template, setTemplate] = useState<InspectionTemplate | null>(null)
  const [runs, setRuns] = useState<readonly InspectionRun[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [correcting, setCorrecting] = useState<InspectionRun | null>(null)

  useEffect(() => {
    let live = true
    getVehicleTemplate(sysid)
      .then((t) => live && setTemplate(t))
      .catch((e: unknown) => live && setError(message(e)))
    return () => {
      live = false
    }
  }, [sysid])

  useEffect(() => {
    let live = true
    listInspections(sysid)
      .then((r) => live && setRuns(r.slice(0, RECENT)))
      .catch((e: unknown) => live && setError(message(e)))
    return () => {
      live = false
    }
  }, [sysid, version])

  return (
    <div className="maint-body lb-grid">
      {template ? (
        <InspectionForm
          key={correcting?.id ?? 'new'}
          template={template}
          sysid={sysid}
          vehicle={vehicle}
          me={me}
          dict={dict}
          correcting={correcting}
          onCancelCorrection={() => setCorrecting(null)}
          onSaved={() => {
            setCorrecting(null)
            setVersion((n) => n + 1)
          }}
          onMaintenanceDraft={onMaintenanceDraft}
        />
      ) : (
        <div className="surface">{error && <div className="warnbox fatal">{error}</div>}</div>
      )}
      <InspectionsPane runs={runs} error={template ? error : null} dict={dict} onCorrect={setCorrecting} />
    </div>
  )
}
