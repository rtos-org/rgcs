// Cards that spin propellers: motor test and ESC calibration. Both stay locked until the
// operator states the propellers are off; the server still asks for a confirm token.
import { useState } from 'react'
import { ApiError } from '../../shared/api/client'
import type { Dict } from '../../shared/i18n'
import { motorTest, type MotorRun } from './api'

const DEFAULT_PCT = 5
const DEFAULT_SECONDS = 2
const MAX_PCT = 30
const MAX_SECONDS = 10

const letter = (i: number) => String.fromCharCode(65 + i)
const message = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e))

export function PropsOff({ on, dict, onChange }: { on: boolean; dict: Dict; onChange: (on: boolean) => void }) {
  return (
    <label className="row calib-props">
      <button type="button" role="switch" className="switch" aria-checked={on} aria-label={dict.calPropsOff} onClick={() => onChange(!on)}>
        <span className="knob" />
      </button>
      <span className="t2">{dict.calPropsOff}</span>
    </label>
  )
}

interface MotorProps {
  readonly sysid: number
  readonly motors: number
  readonly locked: boolean
  readonly dict: Dict
  readonly onRun: () => void
}

export function MotorPanel({ sysid, motors, locked, dict, onRun }: MotorProps) {
  const [propsOff, setPropsOff] = useState(false)
  const [pct, setPct] = useState(DEFAULT_PCT)
  const [seconds, setSeconds] = useState(DEFAULT_SECONDS)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const run = (r: MotorRun, label: string) => {
    setBusy(true)
    motorTest(sysid, r)
      .then((reply) => setNote(reply.ok ? { ok: true, text: dict.calMotorSpun.replace('{m}', label) } : { ok: false, text: reply.reason ?? dict.calFailedNow }))
      .catch((e: unknown) => setNote({ ok: false, text: message(e) }))
      .finally(() => {
        setBusy(false)
        onRun()
      })
  }
  const disabled = locked || busy || !propsOff
  const runOne = { pct, seconds, count: 0 }
  return (
    <div className="calib-flow">
      <div className="t3 calib-hint">{dict.calMotorHint}</div>
      <PropsOff on={propsOff} dict={dict} onChange={setPropsOff} />
      <div className="row calib-inputs">
        <label className="t2">
          {dict.calMotorThrottle}
          <input className="in num" type="number" min={1} max={MAX_PCT} value={pct} onChange={(e) => setPct(clamp(Number(e.target.value), 1, MAX_PCT))} />%
        </label>
        <label className="t2">
          {dict.calMotorSeconds}
          <input className="in num" type="number" min={1} max={MAX_SECONDS} value={seconds} onChange={(e) => setSeconds(clamp(Number(e.target.value), 1, MAX_SECONDS))} />s
        </label>
      </div>
      <div className="calib-motors">
        {Array.from({ length: motors }, (_, i) => (
          <button key={i} type="button" className="btn" disabled={disabled} onClick={() => run({ motor: i + 1, ...runOne }, letter(i))}>
            {letter(i)}
          </button>
        ))}
      </div>
      <button type="button" className="btn" disabled={disabled} onClick={() => run({ motor: 1, pct, seconds, count: motors }, `A–${letter(motors - 1)}`)}>
        {dict.calMotorAll}
      </button>
      {note && <div className={`t3 ${note.ok ? 'sev-ok' : 'sev-error'}`}>{note.text}</div>}
    </div>
  )
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : lo)

interface EscProps {
  readonly locked: boolean
  readonly busy: boolean
  readonly dict: Dict
  readonly onWrite: () => void
}

export function EscPanel({ locked, busy, dict, onWrite }: EscProps) {
  const [propsOff, setPropsOff] = useState(false)
  return (
    <div className="calib-flow">
      <div className="t3 calib-hint">{dict.calEscHint}</div>
      <PropsOff on={propsOff} dict={dict} onChange={setPropsOff} />
      <button type="button" className="btn btn-primary" disabled={locked || busy || !propsOff} onClick={onWrite}>
        {dict.calEscWrite}
      </button>
    </div>
  )
}
