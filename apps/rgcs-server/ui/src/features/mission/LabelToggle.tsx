import { useRef, useState } from 'react'
import type { Dict } from '../../shared/i18n'
import { IconCheck, IconTags } from '../../shared/ui/icons'
import { useDismiss } from '../map/useDismiss'
import type { LabelKey, LabelPrefs } from './labelPrefs'

interface Props {
  readonly prefs: LabelPrefs
  readonly dict: Dict
  readonly onToggle: (key: LabelKey) => void
  /** Placement classes (prototype `float map-r top2|top3`). */
  readonly className?: string
}

/** Map labels button + menu: show or hide the WP numbers, the altitude chips and the + between WPs, one by one. */
export function LabelToggle({ prefs, dict, onToggle, className = 'float map-r top3' }: Props) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useDismiss(open, box, () => setOpen(false))
  const items: readonly [LabelKey, string][] = [
    ['wpNumbers', dict.mLabelWp],
    ['altitudes', dict.mLabelAlt],
    ['insertHandles', dict.mLabelInsert],
  ]
  return (
    <div ref={box} className={`basemap-picker ${className}`}>
      <button type="button" className="g-ctl btn-icon" aria-label={dict.mLabels} title={dict.mLabels} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <IconTags />
      </button>
      {open && (
        <div className="g-strong basemap-menu" role="menu" aria-label={dict.mLabels}>
          {items.map(([key, label]) => (
            <button key={key} type="button" role="menuitemcheckbox" aria-checked={prefs[key]} className={prefs[key] ? 'on' : ''} onClick={() => onToggle(key)}>
              <span className="grow">{label}</span>
              {prefs[key] && <IconCheck size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
