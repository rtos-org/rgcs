// The map button that shows or hides the photo footprints of the surveys (remembered per browser).
import type { Dict } from '../../shared/i18n'
import { IconSurvey } from '../../shared/ui/icons'

interface Props {
  /** Shown only while the mission has a survey. */
  readonly visible: boolean
  readonly on: boolean
  readonly onToggle: () => void
  readonly dict: Dict
}

export function SurveyFootToggle({ visible, on, onToggle, dict }: Props) {
  if (!visible) return null
  return (
    <button type="button" className={`g-ctl ctl float map-r2 top2 sv-foot-btn${on ? ' on' : ''}`} title={dict.svFootToggle} aria-label={dict.svFootToggle} aria-pressed={on} onClick={onToggle}>
      <IconSurvey size={18} />
    </button>
  )
}
