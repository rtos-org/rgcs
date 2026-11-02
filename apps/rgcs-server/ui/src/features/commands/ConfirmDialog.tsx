import { useEffect, useRef, useState } from 'react'
import type { VehicleCommand, VehicleState } from '../../shared/api/types'
import { cmdLabel, type Dict } from '../../shared/i18n'
import { IconSparkles } from '../../shared/ui/icons'
import { haversineM } from '../mission/geo'
import { requestConfirm, sendCommand } from './api'
import { DESTRUCTIVE, takeoffKind } from './catalog'
import { useConfirmKeys } from './confirmKeys'
import { runCommand, type RunResult, type SendFn } from './useCommand'

interface Deps {
  readonly confirm: typeof requestConfirm
  readonly send: SendFn
}

interface Props {
  readonly sysid: number
  readonly command: VehicleCommand
  readonly vehicleName: string
  /** The target's live state, for the context row. */
  readonly vehicle?: VehicleState
  /** Why we are asking again (e.g. the server said the previous token expired). */
  readonly message?: string
  readonly onCancel: () => void
  readonly onDone: (result: RunResult) => void
  readonly dict: Dict
  readonly deps?: Deps
  /** The AI proposal this confirm executes (`ai_proposal_id`). */
  readonly aiProposalId?: string
  /** The AI's reason, shown as 「AI の提案: …」. */
  readonly note?: string
}

const HOLD_MS = 1500

function describe(command: VehicleCommand, dict: Dict, v: VehicleState | undefined): string {
  const label = cmdLabel(command.cmd, dict)
  if (command.cmd === 'takeoff') return v && takeoffKind(v) === 'tkoff_alt' ? `${label} → TKOFF_ALT` : `${label} → ${command.args.alt_rel} m`
  if (command.cmd === 'set_mode') return `${label} → ${command.args.mode}`
  if (command.cmd === 'change_alt') return `${label} → ${command.args.alt_rel} m`
  if (command.cmd === 'change_speed') return `${label} → ${command.args.mps} m/s`
  return label
}

/**
 * Disarming stops the motors: an armed vehicle always needs a deliberate hold (operator proposal 4).
 * Not gated on `alt_rel` — it reads ≤ 1 m in the air below the home altitude or with baro drift.
 */
export const needsHold = (command: VehicleCommand, v: VehicleState | undefined): boolean => command.cmd === 'disarm' && v !== undefined && v.armed

/** What the operator needs to judge the command: mode, altitude, battery, distance from home. */
function ContextRow({ v, dict }: { v: VehicleState; dict: Dict }) {
  const home = v.home && !(v.home.lat === 0 && v.home.lon === 0) ? Math.round(haversineM(v.lat, v.lon, v.home.lat, v.home.lon)) : null
  // a rover has no altitude to judge
  const parts = [v.mode, v.kind === 'rover' ? null : `${dict.ctxAlt} ${Math.round(v.alt_rel)} m`, `${dict.ctxBattery} ${v.battery.pct === null ? '—' : `${v.battery.pct}%`}`, home === null ? null : `${dict.fromHome} ${home} m`]
  return (
    <div className="confirm-ctx num t2" data-testid="confirm-ctx">
      {parts.filter(Boolean).join(' · ')}
    </div>
  )
}

function HoldButton({ busy, dict, onFire }: { busy: boolean; dict: Dict; onFire: () => void }) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
  }
  useEffect(() => stop, [])
  const start = (e: React.PointerEvent) => {
    if (busy || e.button !== 0) return
    setHolding(true)
    timer.current = setTimeout(() => {
      timer.current = null
      setHolding(false)
      onFire()
    }, HOLD_MS)
  }
  return (
    <button type="button" className={`btn btn-danger hold${holding ? ' holding' : ''}`} disabled={busy} onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}>
      <span className="hold-fill" aria-hidden="true" />
      <span className="hold-label">{dict.holdToRun}</span>
    </button>
  )
}

/** Confirm step for the commands that need a token (arm, disarm, takeoff, mission start): fetch a token, then send with it. */
function AiNote({ note, dict }: { note: string; dict: Dict }) {
  return (
    <div className="t3 row confirm-ai" data-testid="confirm-ai-note">
      <IconSparkles />
      <span>
        {dict.aiProposalLabel}: {note}
      </span>
    </div>
  )
}

export function ConfirmDialog({ sysid, command, vehicleName, vehicle, message, onCancel, onDone, dict, deps, aiProposalId, note }: Props) {
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const box = useRef<HTMLDivElement>(null)
  const confirm = deps?.confirm ?? requestConfirm
  const send = deps?.send ?? sendCommand
  const execute = async () => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      const { confirm_token } = await confirm(sysid, command.cmd)
      onDone(await runCommand(sysid, command, confirm_token, send, { aiProposalId }))
    } catch (e) {
      onDone({ kind: 'error', code: 'unknown', message: e instanceof Error ? e.message : String(e) })
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const hold = needsHold(command, vehicle)
  useConfirmKeys(box, hold ? null : () => void execute(), () => !running.current && onCancel())
  const danger = DESTRUCTIVE.has(command.cmd)
  return (
    <div className="modal-backdrop">
      <div ref={box} className="g-strong confirm" role="dialog" aria-label={dict.confirmTitle}>
        <div className="h2">{dict.confirmTitle}</div>
        <div className="confirm-body">
          <span className="confirm-cmd">{describe(command, dict, vehicle)}</span>
          <span className="t2">{vehicleName}</span>
        </div>
        {vehicle && <ContextRow v={vehicle} dict={dict} />}
        {note !== undefined && <AiNote note={note} dict={dict} />}
        {message && <div className="warnbox">{message}</div>}
        <div className="confirm-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {dict.cancel}
          </button>
          {hold ? (
            <HoldButton busy={busy} dict={dict} onFire={() => void execute()} />
          ) : (
            <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => void execute()} disabled={busy}>
              {dict.execute}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
