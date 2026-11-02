import { useState, useSyncExternalStore } from 'react'
import type { CommandResult, InspectorRow, SysId, VehicleCommand, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { runCommand, type SendFn } from '../commands/useCommand'
import { vehicleStore } from '../vehicles/store'
import { canStop, INTERVAL_DEFAULT, INTERVAL_STOP, intervalCommand, intervalUs, isCoreTelemetry, isHeartbeat, parseHz, rateAllowed, rateGate, type RateGate } from './rate'

const AUTOPILOT_COMPID = 1

interface Props {
  readonly row: InspectorRow
  /** Default to the live store (subscribed here, narrowly); tests inject them. */
  readonly vehicles?: ReadonlyMap<SysId, VehicleState>
  readonly results?: readonly CommandResult[]
  readonly dict: Dict
  readonly send?: SendFn
}

type Sent = { readonly kind: 'pending' } | { readonly kind: 'queued'; readonly id: number } | { readonly kind: 'error'; readonly message: string }

/** Only the link / arming state and the results: telemetry frames do not re-render the inspector. */
function useLive(sysid: SysId, vehicles: Props['vehicles'], results: Props['results']) {
  const gate = useSyncExternalStore(vehicleStore.subscribe, () => rateGate(vehicleStore.getState(), sysid))
  const live = useSyncExternalStore(vehicleStore.subscribe, () => vehicleStore.getState().results)
  return { gate: vehicles ? rateGate({ vehicles }, sysid) : gate, results: results ?? live }
}

function noteFor(row: InspectorRow, gate: RateGate, dict: Dict): string | null {
  if (row.dir !== 'rx') return dict.inspRateNoteTx
  if (row.compid !== AUTOPILOT_COMPID) return dict.inspRateNoteComp
  if (isHeartbeat(row.msg_id)) return dict.inspRateNoteHeartbeat
  if (gate === 'unknown' || gate === 'lost') return dict.inspRateNoteOffline
  return null
}

function Outcome({ sent, result, dict }: { sent: Sent | null; result: CommandResult | undefined; dict: Dict }) {
  if (sent === null || sent.kind === 'pending') return null
  if (sent.kind === 'error') return <div className="t3 insp-rate-out" role="status">{`${dict.inspRateFail}: ${sent.message}`}</div>
  if (result === undefined) return <div className="t3 insp-rate-out" role="status">{dict.inspRateSent}</div>
  return <div className="t3 insp-rate-out" role="status">{result.ok ? dict.inspRateOk : `${dict.inspRateFail}${result.reason ? `: ${result.reason}` : ''}`}</div>
}

/** SET_MESSAGE_INTERVAL for the selected message: a rate in Hz, back to the default, or stopped. */
export function RateControls({ row, vehicles, results, dict, send }: Props) {
  const live = useLive(row.sysid, vehicles, results)
  const note = noteFor(row, live.gate, dict)
  if (note !== null) return <div className="t3 insp-rate-note" data-testid="insp-rate-note">{note}</div>
  return <Controls row={row} armed={live.gate === 'armed'} results={live.results} dict={dict} send={send} />
}

interface ControlsProps {
  readonly row: InspectorRow
  readonly armed: boolean
  readonly results: readonly CommandResult[]
  readonly dict: Dict
  readonly send: SendFn | undefined
}

function Controls({ row, armed, results, dict, send }: ControlsProps) {
  const [text, setText] = useState('10')
  const [sent, setSent] = useState<Sent | null>(null)
  const parsed = parseHz(text)
  const hz = parsed !== null && rateAllowed(parsed, row.msg_id, armed) ? parsed : null
  const result = sent?.kind === 'queued' ? results.find((x) => x.id === sent.id) : undefined
  const busy = sent?.kind === 'pending' || (sent?.kind === 'queued' && result === undefined)
  const guarded = armed && isCoreTelemetry(row.msg_id)
  const issue = (command: VehicleCommand) => {
    if (busy) return
    setSent({ kind: 'pending' })
    void runCommand(row.sysid, command, undefined, send).then((r) => setSent(r.kind === 'queued' ? r : { kind: 'error', message: r.kind === 'error' ? r.message : '' }))
  }
  return (
    <div className="insp-rate">
      <div className="row insp-rate-row">
        <label className="t2" htmlFor="insp-rate-hz">{dict.inspRate}</label>
        <input id="insp-rate-hz" className="in num" inputMode="decimal" value={text} aria-invalid={hz === null} onChange={(e) => setText(e.target.value)} />
        <span className="t2">Hz</span>
        <button type="button" className="btn btn-primary" disabled={hz === null || busy} onClick={() => hz !== null && issue(intervalCommand(row.msg_id, intervalUs(hz)))}>{dict.inspRateSet}</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => issue(intervalCommand(row.msg_id, INTERVAL_DEFAULT))}>{dict.inspRateDefault}</button>
        <button type="button" className="btn btn-ghost" disabled={busy || !canStop(row.msg_id, armed)} onClick={() => canStop(row.msg_id, armed) && issue(intervalCommand(row.msg_id, INTERVAL_STOP))}>{dict.inspRateStop}</button>
      </div>
      {hz === null && <div className="t3 insp-rate-invalid">{parsed !== null ? dict.inspRateArmedMin : dict.inspRateInvalid}</div>}
      {guarded && <div className="t3 insp-rate-note">{dict.inspRateCoreArmed}</div>}
      <div className="t3 num">{`${dict.inspRateMeasured}: ${row.rate_hz > 0 ? `${row.rate_hz.toFixed(1)} Hz` : '—'}`}</div>
      <Outcome sent={sent} result={result} dict={dict} />
    </div>
  )
}
