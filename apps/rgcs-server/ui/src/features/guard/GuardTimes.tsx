// カウントダウン / 引き継ぎ待ち (fixed values: countdown 3..=15 s, takeover wait 10..=120 s), checked with zod
// before any request; the server validates again.
import { useState } from 'react'
import { z } from 'zod'
import type { Dict } from '../../shared/i18n'

interface Props {
  readonly countdown: number
  readonly wait: number
  readonly disabled: boolean
  readonly dict: Dict
  readonly onSave: (v: { countdown_s: number; takeover_wait_s: number }) => Promise<boolean>
}

const timesSchema = z.object({
  countdown_s: z.number().int().min(3).max(15),
  takeover_wait_s: z.number().int().min(10).max(120),
})

/** The parsed values, or the first out-of-range field's message (an empty field reads as 0, out of range). */
export function checkTimes(countdown: string, wait: string, dict: Dict): { countdown_s: number; takeover_wait_s: number } | string {
  const parsed = timesSchema.safeParse({ countdown_s: Number(countdown), takeover_wait_s: Number(wait) })
  if (parsed.success) return parsed.data
  return parsed.error.issues[0]?.path[0] === 'countdown_s' ? dict.guardCountdownRange : dict.guardWaitRange
}

export function GuardTimes({ countdown, wait, disabled, dict, onSave }: Props) {
  const [cd, setCd] = useState<string | null>(null)
  const [tw, setTw] = useState<string | null>(null)
  const [issue, setIssue] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const cdText = cd ?? String(countdown)
  const twText = tw ?? String(wait)
  const save = async () => {
    const r = checkTimes(cdText, twText, dict)
    setSaved(false)
    if (typeof r === 'string') return setIssue(r)
    setIssue(null)
    if (await onSave(r)) {
      setCd(null)
      setTw(null)
      setSaved(true)
    }
  }
  return (
    <div className="guard-times">
      <TimeRow id="guard-countdown" label={dict.guardCountdown} note={dict.guardCountdownNote} value={cdText} min={3} max={15} disabled={disabled} onChange={setCd} />
      <TimeRow id="guard-wait" label={dict.guardTakeoverWait} note={dict.guardTakeoverWaitNote} value={twText} min={10} max={120} disabled={disabled} onChange={setTw} />
      {!disabled && (
        <div className="row guard-times-actions">
          {issue && <span className="settings-issue">{issue}</span>}
          {saved && !issue && <span className="t3">{dict.guardSaved}</span>}
          <button type="button" className="btn btn-sm" disabled={cd === null && tw === null} onClick={() => void save()}>
            {dict.guardSaveTimes}
          </button>
        </div>
      )}
    </div>
  )
}

interface RowProps {
  readonly id: string
  readonly label: string
  readonly note: string
  readonly value: string
  readonly min: number
  readonly max: number
  readonly disabled: boolean
  readonly onChange: (v: string) => void
}

function TimeRow({ id, label, note, value, min, max, disabled, onChange }: RowProps) {
  return (
    <div className="setrow">
      <div>
        <label htmlFor={id} style={{ fontSize: 14, fontWeight: 500 }}>
          {label}
        </label>
        <div className="t3" style={{ fontSize: 12, marginTop: 3 }}>
          {note}
        </div>
      </div>
      <input id={id} type="number" min={min} max={max} className="in num" style={{ width: 88 }} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
