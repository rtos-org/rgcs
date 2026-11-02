// The planner's right panel folded to a narrow rail, and the button that folds it (spec 2026-10-20 §9).
import type { Dict } from '../../shared/i18n'
import { IconPanelRightClose, IconPanelRightOpen } from '../../shared/ui/icons'

/** In a right panel's header: folds the panel to its rail. */
export function CollapseButton({ dict, onCollapse }: { readonly dict: Dict; readonly onCollapse: () => void }) {
  return (
    <button type="button" className="btn-icon sm plan-collapse" title={dict.plPanelCollapse} aria-label={dict.plPanelCollapse} onClick={onCollapse}>
      <IconPanelRightClose size={16} />
    </button>
  )
}

/** The folded panel: only the button that opens it again (the panel's content is not rendered). */
export function PlanRail({ dict, onExpand }: { readonly dict: Dict; readonly onExpand: () => void }) {
  return (
    <div className="g panel float float-r plan-rail">
      <button type="button" className="btn-icon" title={dict.plPanelExpand} aria-label={dict.plPanelExpand} onClick={onExpand}>
        <IconPanelRightOpen size={18} />
      </button>
    </div>
  )
}
