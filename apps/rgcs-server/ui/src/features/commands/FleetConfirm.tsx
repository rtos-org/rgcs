import { useRef, useState } from 'react'
import type { VehicleCommand, VehicleState } from '../../shared/api/types'
import { cmdLabel, type Dict } from '../../shared/i18n'
import { requestConfirm, sendCommand } from './api'
import { DESTRUCTIVE } from './catalog'
import { useConfirmKeys } from './confirmKeys'
import { runFleet, type FleetDeps, type Skipped } from './fleet'

interface Props {
  readonly command: VehicleCommand
  readonly targets: readonly VehicleState[]
  /** Vehicles left out (disarmed / no link), listed with the reason. */
  readonly skipped?: readonly Skipped[]
  readonly dict: Dict
  readonly onClose: () => void
  /** Each vehicle's outcome (failures are logged like any command result). */
  readonly onResult: (sysid: number, ok: boolean, message?: string) => void
  readonly deps?: FleetDeps
}

type Status = 'sending' | 'ok' | 'fail'

/** Confirm + progress for a fleet command: the targets are listed by name before anything is sent. */
export function FleetConfirm({ command, targets, skipped = [], dict, onClose, onResult, deps }: Props) {
  const [status, setStatus] = useState<ReadonlyMap<number, Status> | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const title = `${dict.fleet} ${cmdLabel(command.cmd, dict)}`
  const execute = () => {
    if (status || targets.length === 0) return
    setStatus(new Map(targets.map((v) => [v.sysid, 'sending'])))
    void runFleet(
      command,
      targets.map((v) => v.sysid),
      deps ?? { confirm: requestConfirm, send: sendCommand },
      (r) => {
        onResult(r.sysid, r.ok, r.message)
        setStatus((m) => new Map(m ?? []).set(r.sysid, r.ok ? 'ok' : 'fail'))
      },
    )
  }
  // The commands are in flight once sent: closing only hides the progress (results reach the log).
  useConfirmKeys(box, status ? null : execute, onClose)
  return (
    <div className="modal-backdrop">
      <div ref={box} className="g-strong confirm" role="dialog" aria-label={title}>
        <div className="h2">{title}</div>
        <Scope targets={targets.length} skipped={skipped} dict={dict} />
        <ul className="fleet-list">
          {targets.map((v) => (
            <li key={v.sysid} data-testid={`fleet-${v.sysid}`} className={status?.get(v.sysid) ?? ''}>
              <span>{v.name}</span>
              <span className="t3 num">{v.mode}</span>
            </li>
          ))}
        </ul>
        <SkippedList skipped={skipped} dict={dict} />
        <div className="confirm-actions">
          {status ? (
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {dict.close}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                {dict.cancel}
              </button>
              <button type="button" className={`btn ${DESTRUCTIVE.has(command.cmd) ? 'btn-danger' : 'btn-primary'}`} disabled={targets.length === 0} onClick={execute}>
                {dict.execute}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** 「対象: アーム中の 1 機 (3 機は対象外)」; the skipped vehicles follow the targets with their reason. */
function Scope({ targets, skipped, dict }: { readonly targets: number; readonly skipped: readonly Skipped[]; readonly dict: Dict }) {
  const scope = targets === 0 ? dict.fleetNone : dict.fleetScope.replace('{n}', String(targets)) + (skipped.length > 0 ? ` ${dict.fleetSkippedN.replace('{n}', String(skipped.length))}` : '')
  return (
    <div className={targets === 0 ? 'hint caution fleet-scope' : 't2 fleet-scope'} data-testid="fleet-scope">
      {scope}
    </div>
  )
}

function SkippedList({ skipped, dict }: { readonly skipped: readonly Skipped[]; readonly dict: Dict }) {
  if (skipped.length === 0) return null
  return (
    <ul className="fleet-list skipped" aria-label={dict.fleetSkippedTitle}>
      {skipped.map(({ vehicle, reason }) => (
        <li key={vehicle.sysid} data-testid={`fleet-skip-${vehicle.sysid}`}>
          <span>{vehicle.name}</span>
          <span className="t3">{reason === 'lost' ? dict.fleetSkipLost : dict.fleetSkipDisarmed}</span>
        </li>
      ))}
    </ul>
  )
}
