// 飛行日誌 tab: period, four sub-tabs (飛行記録 / 日常点検記録 / 点検整備記録 /
// ログ) and the PDF / CSV export links for the form behind the open sub-tab.
import { useEffect, useState } from 'react'
import type { Flight, InspectionRun, LogFetchProgress, MaintenanceInput, Operator, SysId, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { listInspections } from './api'
import type { FormNumber } from './api'
import { ExportBar } from './ExportBar'
import { FlightsPane } from './FlightsPane'
import { monthRange } from './format'
import { InspectionsPane } from './InspectionsPane'
import { LogsPane } from './LogsPane'
import { MaintenancePane } from './MaintenancePane'

export type SubTab = 'flights' | 'inspections' | 'maintenance' | 'logs'
const SUBS: readonly SubTab[] = ['flights', 'inspections', 'maintenance', 'logs']
const FORM: Record<SubTab, FormNumber | null> = { flights: 1, inspections: 2, maintenance: 3, logs: null }

interface Props {
  readonly sysid: number
  readonly vehicles: ReadonlyMap<SysId, VehicleState>
  readonly me: Operator
  readonly dict: Dict
  readonly draft: Flight | undefined
  readonly logFetch: LogFetchProgress | undefined
  readonly maintDraft: MaintenanceInput | null
  readonly onMaintDraftConsumed: () => void
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function subLabel(s: SubTab, dict: Dict): string {
  return s === 'flights' ? dict.lbSubFlights : s === 'inspections' ? dict.lbSubInspections : s === 'maintenance' ? dict.lbSubMaintenance : dict.lbSubLogs
}

function InspectionsInPeriod({ sysid, from, to, dict }: { sysid: number; from: string; to: string; dict: Dict }) {
  const [runs, setRuns] = useState<readonly InspectionRun[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    listInspections(sysid, from, to)
      .then((r) => live && setRuns(r))
      .catch((e: unknown) => live && setError(message(e)))
    return () => {
      live = false
    }
  }, [sysid, from, to])
  return <InspectionsPane runs={runs} error={error} dict={dict} />
}

export function LogbookTab({ sysid, vehicles, me, dict, draft, logFetch, maintDraft, onMaintDraftConsumed }: Props) {
  const [period, setPeriod] = useState(() => monthRange(new Date()))
  const [sub, setSub] = useState<SubTab>('flights')
  const [prefill, setPrefill] = useState<MaintenanceInput | null>(null)
  const [seen, setSeen] = useState<MaintenanceInput | null>(null)
  if (maintDraft !== null && maintDraft !== seen) {
    setSeen(maintDraft)
    setPrefill(maintDraft)
    setSub('maintenance')
  }
  useEffect(() => {
    if (maintDraft !== null) onMaintDraftConsumed()
  }, [maintDraft, onMaintDraftConsumed])
  const form = FORM[sub]
  void vehicles
  return (
    <div className="maint-body" style={{ flexDirection: 'column', gap: 12 }}>
      <div className="row lb-period">
        <label htmlFor="lb-from">{dict.lbPeriod}</label>
        <input id="lb-from" className="in" type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
        <label htmlFor="lb-to">〜</label>
        <input id="lb-to" className="in" type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
        <span className="t3 lb-tz">{dict.lbTimesJst}</span>
        <div className="seg n4 g-ctl lb-sub">
          <span className="lens" style={{ transform: `translateX(${SUBS.indexOf(sub) * 100}%)` }} />
          {SUBS.map((s) => (
            <button key={s} type="button" className={s === sub ? 'on' : ''} onClick={() => setSub(s)}>
              {subLabel(s, dict)}
            </button>
          ))}
        </div>
        <div className="grow" />
        {form !== null && <ExportBar sysid={sysid} form={form} from={period.from} to={period.to} dict={dict} />}
      </div>
      {sub === 'flights' && <FlightsPane sysid={sysid} from={period.from} to={period.to} dict={dict} draft={draft} />}
      {sub === 'inspections' && <InspectionsInPeriod sysid={sysid} from={period.from} to={period.to} dict={dict} />}
      {sub === 'maintenance' && <MaintenancePane sysid={sysid} from={period.from} to={period.to} dict={dict} engineer={me.username} prefill={prefill} />}
      {sub === 'logs' && <LogsPane sysid={sysid} from={period.from} to={period.to} dict={dict} progress={logFetch} />}
    </div>
  )
}
