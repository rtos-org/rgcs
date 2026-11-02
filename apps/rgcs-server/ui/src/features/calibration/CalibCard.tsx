// One 点検・校正 card (prototype `calibItems`): dot + name + last run, 校正を開始; opened, it
// shows the instructions, then the live session or the motor / ESC panel.
import type { CalibKind, CalibStatus } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { AccelFlow, CompassFlow, RcFlow, Result } from './flows'
import { EscPanel, MotorPanel } from './panels'
import { isActive, type CardStatus } from './status'

const LABEL: Record<CalibKind, keyof Dict> = {
  accel: 'calAccel',
  compass: 'calCompass',
  level: 'calLevel',
  rc: 'calRc',
  esc: 'calEsc',
  motor: 'calMotor',
}

const HINT: Record<CalibKind, keyof Dict> = {
  accel: 'calAccelHint',
  compass: 'calCompassHint',
  level: 'calLevelHint',
  rc: 'calRcHint',
  esc: 'calEscHint',
  motor: 'calMotorHint',
}

interface Props {
  readonly kind: CalibKind
  readonly sysid: number
  readonly card: CardStatus
  readonly open: boolean
  /** This card's session (live or just finished), once started. */
  readonly status: CalibStatus | null
  readonly locked: boolean
  readonly busy: boolean
  readonly error: string | null
  readonly motors: number
  readonly dict: Dict
  readonly onOpen: () => void
  readonly onClose: () => void
  readonly onStart: () => void
  readonly onStep: (step: 'next' | 'cancel' | 'finish') => void
  readonly onReboot: () => void
  readonly onRecorded: () => void
}

export function CalibCard(p: Props) {
  const { kind, card, open, status, dict } = p
  const live = status !== null && isActive(status)
  return (
    <div className={`surface calib-card${open ? ' open' : ''}`} data-testid={`calib-${kind}`}>
      <div className="row calib-head">
        <span className={`dot tone-${live ? 'run' : card.tone}`} />
        <span className="h2">{dict[LABEL[kind]]}</span>
        {open && !live && (
          <button type="button" className="btn btn-ghost btn-sm calib-close" onClick={p.onClose}>
            {dict.calClose}
          </button>
        )}
      </div>
      <div className="t3 num calib-status">{live ? dict.calRunning : card.text}</div>
      {open ? <Body {...p} /> : (
        <button type="button" className="btn calib-start" disabled={p.locked} onClick={p.onOpen}>
          {kind === 'motor' ? dict.calMotorStart : dict.calStart}
        </button>
      )}
      {open && p.error && <div className="t3 sev-error">{p.error}</div>}
    </div>
  )
}

function Body(p: Props) {
  const { kind, status, dict } = p
  if (kind === 'motor') return <MotorPanel sysid={p.sysid} motors={p.motors} locked={p.locked} dict={dict} onRun={p.onRecorded} />
  if (status && !isActive(status)) return <Result status={status} dict={dict} onReboot={p.onReboot} />
  if (kind === 'esc') return <EscPanel locked={p.locked} busy={p.busy} dict={dict} onWrite={p.onStart} />
  if (status) {
    const flow = { status, dict, busy: p.busy, onStep: p.onStep }
    if (kind === 'accel') return <AccelFlow {...flow} />
    if (kind === 'compass') return <CompassFlow {...flow} />
    if (kind === 'rc') return <RcFlow {...flow} />
  }
  return (
    <div className="calib-flow">
      <div className="t3 calib-hint">{dict[HINT[kind]]}</div>
      <button type="button" className="btn btn-primary calib-start" disabled={p.locked || p.busy} onClick={p.onStart}>
        {status ? dict.calRunning : dict.calGo}
      </button>
    </div>
  )
}
