import { useState } from 'react'
import type { VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { requestConfirm, sendCommand } from '../commands/api'
import type { LatLon } from '../map/store'
import { vehicleStore } from '../vehicles/store'
import { sendGuided, type AltMode } from './api'
import { pollUntil, startGuided, type GuidedOutcome, type StartDeps } from './run'
import { IconClose } from '../../shared/ui/icons'

type Deps = StartDeps

function liveDeps(sysid: number): Deps {
  return {
    mode: () => vehicleStore.getState().vehicles.get(sysid)?.mode ?? null,
    confirm: requestConfirm,
    command: sendCommand,
    waitFor: pollUntil,
    send: sendGuided,
  }
}

interface Props {
  readonly vehicle: VehicleState
  readonly target: LatLon | null
  readonly onPickTarget: () => void
  readonly onClose: () => void
  readonly onDone: (outcome: GuidedOutcome) => void
  readonly dict: Dict
  readonly deps?: Deps
}

/**
 * Guided move: pick a target on the map, keep or set altitude, then one press of
 * 移動開始 switches to GUIDED (if needed), waits for the vehicle to report it and sends the target.
 */
export function GuidedModal({ vehicle, target, onPickTarget, onClose, onDone, dict, deps }: Props) {
  const [altMode, setAltMode] = useState<AltMode>('keep')
  const [altRel, setAltRel] = useState('')
  const [busy, setBusy] = useState(false)
  const altValue = Number(altRel)
  const canStart = target !== null && (altMode === 'keep' || (altRel !== '' && Number.isFinite(altValue)))

  const body = () => ({ lat: target!.lat, lon: target!.lon, alt_mode: altMode, ...(altMode === 'set' ? { alt_rel: altValue } : {}) })

  const start = async () => {
    if (!canStart || busy) return
    setBusy(true)
    const outcome = await startGuided(vehicle.sysid, body(), deps ?? liveDeps(vehicle.sysid))
    setBusy(false)
    onDone(outcome.kind === 'error' && outcome.code === 'mode_timeout' ? { ...outcome, message: dict.guidedModeTimeout } : outcome)
  }

  return (
    <div className="g-strong sheet guided" role="dialog" aria-label={dict.guided}>
      <div className="panel-h">
        <span className="h1">{dict.guided}</span>
        <span className="t2">{vehicle.name}</span>
        <span className="grow" />
        <button type="button" className="btn-icon" aria-label={dict.close} onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="sec">
        <div className="sec-title">{dict.targetLabel}</div>
        {target ? (
          <div className="num guided-target">
            {target.lat.toFixed(6)}, {target.lon.toFixed(6)}
          </div>
        ) : (
          <div className="t3">{dict.pickTarget}</div>
        )}
        <button type="button" className="btn btn-sm" onClick={onPickTarget}>
          {dict.pickOnMap}
        </button>
      </div>
      <div className="sec">
        <div className="sec-title">{dict.altitude}</div>
        <div className="seg sm guided-alt" role="group" aria-label={dict.altitude}>
          <span className="lens" style={{ transform: `translateX(${altMode === 'keep' ? 0 : 100}%)` }} />
          <button type="button" className={altMode === 'keep' ? 'on' : ''} onClick={() => setAltMode('keep')}>
            {dict.altKeep}
          </button>
          <button type="button" className={altMode === 'set' ? 'on' : ''} onClick={() => setAltMode('set')}>
            {dict.altSet}
          </button>
        </div>
        {altMode === 'set' && (
          <input className="rg-num" aria-label={dict.altInput} placeholder={dict.altInput} value={altRel} onChange={(e) => setAltRel(e.target.value)} />
        )}
      </div>
      <div className="sec guided-actions">
        {busy && vehicle.mode !== 'GUIDED' && <div className="t3">{dict.guidedSwitching}</div>}
        <button type="button" className="btn btn-primary" disabled={!canStart || busy} onClick={start}>
          {dict.startMove}
        </button>
      </div>
    </div>
  )
}
