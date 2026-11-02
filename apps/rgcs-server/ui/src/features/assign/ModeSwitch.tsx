// The flight plan screen's 編集 | 割当 switch (spec 2026-10-31 §3.1): beside the plan tabs while
// editing, centred over the map on the board. Hidden by the planner while the editor is busy.
import type { Dict } from '../../shared/i18n'

interface SwitchProps {
  readonly on: boolean
  readonly dict: Dict
  readonly onChange: (on: boolean) => void
}

export function ModeSwitch({ on, dict, onChange }: SwitchProps) {
  const modes = [
    { assign: false, label: dict.asModeEdit },
    { assign: true, label: dict.asModeAssign },
  ]
  return (
    <div className="g-ctl seg float top1 as-modes" role="group" aria-label={dict.asModes}>
      <span className="lens" style={{ width: '50%', transform: `translateX(${on ? 100 : 0}%)` }} />
      {modes.map((m) => (
        <button key={m.label} type="button" className={m.assign === on ? 'on' : ''} aria-pressed={m.assign === on} onClick={() => onChange(m.assign)}>
          {m.label}
        </button>
      ))}
    </div>
  )
}
