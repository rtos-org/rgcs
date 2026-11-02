import type { RoiTarget } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { isSet } from './schema'

interface Props {
  readonly targets: readonly RoiTarget[]
  readonly activeId: string | null
  readonly onStart: (id: string) => void
  readonly onStop: () => void
  readonly dict: Dict
}

/** Cockpit ROI chips (prototype line 788): one per set preset, the active one lit, then 停止. */
export function RoiChips({ targets, activeId, onStart, onStop, dict }: Props) {
  return (
    <div className="g-ctl chips">
      <span className="t3" style={{ fontSize: 11, fontWeight: 600 }}>
        ROI
      </span>
      {targets.filter(isSet).map((r) => {
        const on = r.id === activeId
        return (
          <button key={r.id} type="button" className={on ? 'chip on' : 'chip'} aria-pressed={on} title={on ? dict.roiStop : dict.roiStart} onClick={() => (on ? onStop() : onStart(r.id))}>
            {r.name}
          </button>
        )
      })}
      <button type="button" className="chip" style={{ color: 'var(--text-3)', borderColor: 'transparent' }} title={dict.roiStop} onClick={onStop}>
        {dict.roiStopAction}
      </button>
    </div>
  )
}
