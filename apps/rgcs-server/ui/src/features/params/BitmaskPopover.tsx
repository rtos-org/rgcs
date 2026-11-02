import { useState } from 'react'
import type { Dict } from '../../shared/i18n'
import { IconClose } from '../../shared/ui/icons'
import { bitsOf, unknownBits, withBit } from './bitmask'

interface Props {
  readonly name: string
  readonly value: number
  readonly bits: Readonly<Record<string, string>>
  readonly dict: Dict
  readonly onApply: (value: number) => void
  readonly onClose: () => void
}

/** Mission Planner–style bitmask editor: one checkbox per named bit, the decimal value computed live. */
export function BitmaskPopover({ name, value, bits, dict, onApply, onClose }: Props) {
  const [draft, setDraft] = useState(value)
  const set = new Set(bitsOf(draft))
  const unknown = unknownBits(draft, bits)
  const entries = Object.entries(bits).sort(([a], [b]) => Number(a) - Number(b))
  return (
    <div className="g-strong bits-pop" role="dialog" aria-label={`${name} ${dict.bitsTitle}`}>
      <div className="row bits-head">
        <span className="h2">{name}</span>
        <span className="t3">{dict.bitsTitle}</span>
        <div className="grow" />
        <button type="button" className="btn-icon sm" aria-label={dict.close} onClick={onClose}>
          <IconClose size={16} />
        </button>
      </div>
      <div className="bits-list">
        {entries.map(([bit, label]) => (
          <label key={bit} className="bits-row">
            <input type="checkbox" checked={set.has(Number(bit))} onChange={(e) => setDraft((v) => withBit(v, Number(bit), e.target.checked))} />
            <span className="num t3 bits-no">{bit}</span>
            <span>{label}</span>
          </label>
        ))}
      </div>
      {unknown.length > 0 && (
        <div className="t3 bits-unknown">
          {dict.bitsUnknown}: {unknown.join(', ')}
        </div>
      )}
      <div className="row bits-foot">
        <span className="t2">{dict.paramValue}</span>
        <span className="num big-ish" data-testid="bits-value">
          {draft}
        </span>
        <div className="grow" />
        <button type="button" className="btn" onClick={onClose}>
          {dict.cancel}
        </button>
        <button type="button" className="btn btn-primary" disabled={draft === value} onClick={() => onApply(draft)}>
          {dict.bitsApply}
        </button>
      </div>
    </div>
  )
}
