// The live part of an open card: accelerometer positions, compass progress, RC ranges, result.
import type { CalibStatus, RcRange } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'

const POSITIONS = 6
/** RC bars span the usual PWM range. */
const RC_LO = 800
const RC_HI = 2200

const posLabel = (p: number, dict: Dict) => dict[`calPos${p}` as 'calPos1']

interface FlowProps {
  readonly status: CalibStatus
  readonly dict: Dict
  readonly busy: boolean
  readonly onStep: (step: 'next' | 'cancel' | 'finish') => void
}

export function AccelFlow({ status, dict, busy, onStep }: FlowProps) {
  const pos = status.position
  return (
    <div className="calib-flow">
      <div className="calib-steps" aria-hidden="true">
        {Array.from({ length: POSITIONS }, (_, i) => (
          <span key={i} className={pos === null ? '' : i + 1 < pos ? 'done' : i + 1 === pos ? 'on' : ''} />
        ))}
      </div>
      {status.phase === 'waiting' && pos !== null ? (
        <>
          <div className="calib-pos">{posLabel(pos, dict)}</div>
          <div className="t3 calib-hint">{dict.calAccelHint}</div>
        </>
      ) : (
        <div className="t3 calib-hint">{dict.calAccelWait}</div>
      )}
      <div className="row calib-actions">
        <button type="button" className="btn btn-primary" disabled={busy || status.phase !== 'waiting'} onClick={() => onStep('next')}>
          {dict.calAccelNext}
        </button>
        <CancelButton dict={dict} busy={busy} onStep={onStep} />
      </div>
    </div>
  )
}

export function CompassFlow({ status, dict, busy, onStep }: FlowProps) {
  return (
    <div className="calib-flow">
      <div className="t3 calib-hint">{dict.calCompassHint}</div>
      {status.compass.map((c) => (
        <div key={c.id} className="calib-meter">
          <span className="t2">{dict.calCompassN.replace('{n}', String(c.id + 1))}</span>
          <span className="bar">
            <span style={{ width: `${c.pct}%` }} />
          </span>
          <span className="num t2">{c.pct}%</span>
        </div>
      ))}
      <div className="row calib-actions">
        <CancelButton dict={dict} busy={busy} onStep={onStep} />
      </div>
    </div>
  )
}

const pctOf = (v: number) => `${(Math.min(Math.max(v, RC_LO), RC_HI) - RC_LO) / ((RC_HI - RC_LO) / 100)}%`

function RcRow({ ch, r, dict }: { ch: number; r: RcRange; dict: Dict }) {
  return (
    <div className="calib-meter">
      <span className="t2 num">{dict.calRcCh.replace('{n}', String(ch))}</span>
      <span className="bar rc">
        <span className="range" style={{ left: pctOf(r.min), width: `calc(${pctOf(r.max)} - ${pctOf(r.min)})` }} />
        <span className="mark" style={{ left: pctOf(r.value) }} />
      </span>
      <span className="num t3">{`${r.min}–${r.max}`}</span>
    </div>
  )
}

export function RcFlow({ status, dict, busy, onStep }: FlowProps) {
  return (
    <div className="calib-flow">
      <div className="t3 calib-hint">{dict.calRcHint}</div>
      {status.rc.map((r, i) => (r.max > 0 ? <RcRow key={i} ch={i + 1} r={r} dict={dict} /> : null))}
      <div className="row calib-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onStep('finish')}>
          {dict.calRcFinish}
        </button>
        <CancelButton dict={dict} busy={busy} onStep={onStep} />
      </div>
    </div>
  )
}

function CancelButton({ dict, busy, onStep }: Pick<FlowProps, 'dict' | 'busy' | 'onStep'>) {
  return (
    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onStep('cancel')}>
      {dict.calCancel}
    </button>
  )
}

interface ResultProps {
  readonly status: CalibStatus
  readonly dict: Dict
  readonly onReboot: () => void
}

/** A finished session: outcome, the reason of a failure, the reboot a new compass calibration needs. */
export function Result({ status, dict, onReboot }: ResultProps) {
  const text = status.phase === 'done' ? (status.kind === 'esc' ? dict.calEscArmed : dict.calOk) : status.phase === 'failed' ? dict.calFailedNow : dict.calCancelled
  const tone = status.phase === 'done' ? 'sev-ok' : status.phase === 'failed' ? 'sev-error' : 't2'
  return (
    <div className="calib-flow">
      <div className={`calib-result ${tone}`}>{text}</div>
      {status.phase === 'failed' && status.reason && <div className="t3 num">{status.reason}</div>}
      {status.reboot && (
        <>
          <div className="t3 calib-hint">{dict.calReboot}</div>
          <button type="button" className="btn" onClick={onReboot}>
            {dict.calRebootNow}
          </button>
        </>
      )}
    </div>
  )
}
