// Over the mission list: an edit outside the survey panel touched a survey's items, so the survey
// was detached into plain waypoints. Undo brings it back; the close button only hides the note.
import type { Dict } from '../../shared/i18n'
import { IconClose } from '../../shared/ui/icons'

interface Props {
  /** Names of the detached surveys (may repeat). */
  readonly names: readonly string[]
  readonly dict: Dict
  readonly onUndo: () => void
  readonly onClose: () => void
}

export function SurveyNotice({ names, dict, onUndo, onClose }: Props) {
  if (names.length === 0) return null
  const text = dict.svNotice.replace('{names}', [...new Set(names)].join(dict.svNoticeJoin))
  return (
    <div className="hint caution sv-draw row" role="status" style={{ gap: 8 }}>
      <span className="grow">{text}</span>
      <button type="button" className="btn btn-sm" onClick={onUndo}>
        {dict.svNoticeUndo}
      </button>
      <button type="button" className="btn-icon sm" aria-label={dict.close} onClick={onClose}>
        <IconClose size={14} />
      </button>
    </div>
  )
}
