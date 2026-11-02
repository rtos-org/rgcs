// L0–L3 per event as the prototype's segmented control. L2 / L3 need consent 3.
import type { GuardLevel } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'

const LEVELS: readonly GuardLevel[] = ['l0', 'l1', 'l2', 'l3']

interface Props {
  readonly label: string
  readonly value: GuardLevel
  readonly autoOps: boolean
  readonly disabled: boolean
  readonly dict: Dict
  readonly onChange: (l: GuardLevel) => void
}

export const needsAutoOps = (l: GuardLevel) => l === 'l2' || l === 'l3'

export function LevelSelect({ label, value, autoOps, disabled, dict, onChange }: Props) {
  return (
    <div className="guard-level">
      <div className="seg n4 sm" role="group" aria-label={label}>
        <span className="lens" style={{ transform: `translateX(${LEVELS.indexOf(value) * 100}%)` }} />
        {LEVELS.map((l) => {
          const locked = needsAutoOps(l) && !autoOps
          return (
            <button
              key={l}
              type="button"
              className={[value === l ? 'on' : '', locked ? 'off' : ''].join(' ').trim()}
              aria-pressed={value === l}
              disabled={disabled || locked}
              onClick={() => l !== value && onChange(l)}
            >
              {l.toUpperCase()}
            </button>
          )
        })}
      </div>
      {!autoOps && <div className="t3 guard-note">{dict.guardAutoOpsNeeded}</div>}
    </div>
  )
}
