import { useCallback, useState } from 'react'
import { KindIcon } from '../../shared/ui/KindIcon'
import type { CalibStatus, Flight, LogFetchProgress, MaintenanceInput, Operator, ParamProgress, SysId, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { AppTab } from '../app-settings'
import { CalibTab } from '../calibration'
import { DailyTab } from '../logbook/DailyTab'
import { LogbookTab } from '../logbook/LogbookTab'
import { HistoryTab } from './HistoryTab'
import { InspectorTab } from '../inspector/InspectorTab'
import { ParamsPane } from './ParamsPane'
import { ENABLED_TABS, MAINT_TABS, TAB_LABEL, type MaintTab } from './tabs'
import { ArmChip } from '../vehicles/ArmChip'

interface Props {
  readonly vehicles: ReadonlyMap<SysId, VehicleState>
  readonly paramProgress: ReadonlyMap<SysId, ParamProgress>
  readonly dict: Dict
  /** The vehicle picked in the shell's vehicle list (the only selector); the first one when omitted. */
  readonly selected?: SysId | null
  readonly me: Operator
  /** Opens the 観客用画面 links and logo sheet (アプリ設定 tab). */
  readonly onOpenPresent?: () => void
  readonly onOpenGuard?: () => void
  readonly onOpenEnv?: () => void
  readonly flightDrafts?: ReadonlyMap<SysId, Flight>
  readonly logFetch?: ReadonlyMap<SysId, LogFetchProgress>
  /** Last `calibration` frame per vehicle. */
  readonly calibration?: ReadonlyMap<SysId, CalibStatus>
}

/** メンテナンス・設定 after the prototype's maint screen: header row, tab strip, body. */
export function MaintView({ vehicles, paramProgress, dict, selected, me, onOpenPresent, onOpenGuard, onOpenEnv, flightDrafts, logFetch, calibration }: Props) {
  const list = [...vehicles.values()].sort((a, b) => a.sysid - b.sysid)
  const sysid = selected != null && vehicles.has(selected) ? selected : (list[0]?.sysid ?? null)
  const vehicle = sysid === null ? undefined : vehicles.get(sysid)
  const [tab, setTab] = useState<MaintTab>('params')
  const [writes, setWrites] = useState(0)
  const onWritten = useCallback(() => setWrites((n) => n + 1), [])
  /** A 様式 3 draft handed over from 日常点検 (異常 found); consumed by the 飛行日誌 tab. */
  const [maintDraft, setMaintDraft] = useState<MaintenanceInput | null>(null)
  const onMaintenanceDraft = useCallback((draft: MaintenanceInput) => {
    setMaintDraft(draft)
    setTab('logbook')
  }, [setTab])
  const onMaintDraftConsumed = useCallback(() => setMaintDraft(null), [])
  const tabIndex = MAINT_TABS.indexOf(tab)
  return (
    <section className="float map-l top1 maint" data-testid="maint-view">
      <div className="aurora" />
      {tab !== 'app' && <MaintHead vehicle={vehicle} dict={dict} />}
      <div className={`seg n${MAINT_TABS.length} lg g-ctl maint-tabs`}>
        <span className="lens" style={{ transform: `translateX(${tabIndex * 100}%)` }} />
        {MAINT_TABS.map((tb) => {
          const enabled = ENABLED_TABS.has(tb)
          const label = dict[TAB_LABEL[tb]]
          return (
            <button
              key={tb}
              type="button"
              className={tb === tab ? 'on' : ''}
              aria-disabled={enabled ? undefined : 'true'}
              title={enabled ? label : `${label} (${dict.comingSoon})`}
              onClick={() => enabled && setTab(tb)}
            >
              {label}
            </button>
          )
        })}
      </div>
      <ParamsPane
        key={sysid ?? 'none'}
        sysid={sysid}
        armed={vehicle?.armed === true}
        progress={sysid === null ? undefined : paramProgress.get(sysid)}
        dict={dict}
        hidden={tab !== 'params'}
        onWritten={onWritten}
      />
      {tab === 'calib' && sysid !== null && <CalibTab key={sysid} sysid={sysid} vehicle={vehicle} session={calibration?.get(sysid)} dict={dict} />}
      {tab === 'daily' && sysid !== null && <DailyTab key={sysid} sysid={sysid} vehicle={vehicle} me={me} dict={dict} onMaintenanceDraft={onMaintenanceDraft} />}
      {tab === 'logbook' && sysid !== null && (
        <LogbookTab
          key={sysid}
          sysid={sysid}
          vehicles={vehicles}
          me={me}
          dict={dict}
          draft={flightDrafts?.get(sysid)}
          logFetch={logFetch?.get(sysid)}
          maintDraft={maintDraft}
          onMaintDraftConsumed={onMaintDraftConsumed}
        />
      )}
      {tab === 'inspector' && <InspectorTab dict={dict} />}
      {tab === 'app' && <AppTab sysid={sysid} vehicle={vehicle} me={me} dict={dict} onOpenPresent={onOpenPresent ?? (() => {})} onOpenGuard={onOpenGuard ?? (() => {})} onOpenEnv={onOpenEnv ?? (() => {})} />}
      {tab === 'history' && (
        <div className="maint-body">
          <HistoryTab sysid={sysid} dict={dict} version={writes} />
        </div>
      )}
    </section>
  )
}

/**
 * The vehicle the tabs act on: picked in the vehicle list on the left (the only selector),
 * with its mode and arm state in words. The app-wide アプリ設定 tab has no vehicle header.
 */
function MaintHead({ vehicle, dict }: { readonly vehicle: VehicleState | undefined; readonly dict: Dict }) {
  return (
    <div className="row maint-head" data-testid="maint-head">
      <span className="t2">{dict.maintConnected}</span>
      {vehicle ? (
        <>
          <span className="h1">{vehicle.name}</span>
          <span className="t2 maint-kind">
            <KindIcon kind={vehicle.kind} />
          </span>
          <span className="badge t2">{vehicle.mode}</span>
          <ArmChip armed={vehicle.armed} dict={dict} />
        </>
      ) : (
        <span className="t3">{dict.noVehicles}</span>
      )}
    </div>
  )
}
