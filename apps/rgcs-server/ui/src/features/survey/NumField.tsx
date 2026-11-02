// A labelled number input for the survey panel: edits stay local until blur / Enter, and only a
// valid, changed value is committed. Escape reverts.
import { useState } from 'react'

interface Props {
  readonly id: string
  readonly label: string
  readonly value: number
  /** Decimals shown. */
  readonly digits: number
  readonly valid: (n: number) => boolean
  readonly onCommit: (n: number) => void
  readonly disabled?: boolean
  readonly step?: string
  /** Shown after the input on the same row (unit notes, an 自動 toggle). */
  readonly children?: React.ReactNode
}

/** A number for display; one that is not finite (a footprint shrunk to nothing) reads —. */
export const fmtNum = (n: number, digits: number): string => (Number.isFinite(n) ? n.toFixed(digits) : '—')
/** The same for a number input, which can only show digits (blank instead of —). */
const fmtInput = (n: number, digits: number): string => (Number.isFinite(n) ? n.toFixed(digits) : '')

export function NumField({ id, label, value, digits, valid, onCommit, disabled, step = 'any', children }: Props) {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? fmtInput(value, digits)
  const n = text === null || text.trim() === '' ? NaN : Number(text)
  const bad = text !== null && !(Number.isFinite(n) && valid(n))
  const commit = () => {
    if (text === null || bad) return
    if (text !== fmtInput(value, digits)) onCommit(n)
    setText(null)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commit()
    else if (e.key === 'Escape') setText(null)
  }
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="row sv-field">
        <input id={id} className="in" type="number" step={step} value={shown} disabled={disabled} aria-invalid={bad || undefined} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onKeyDown} />
        {children}
      </div>
    </>
  )
}
