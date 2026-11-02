import type { VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconPower } from '../../shared/ui/icons'
import { modeLabel } from './format'

/** The mode badge: filled with a Power mark while armed, so the arm state never rests on colour alone. */
export function ModeBadge({ v, dict }: { readonly v: VehicleState; readonly dict: Dict }) {
  return (
    <span className={v.armed ? 'badge armed' : 'badge'} title={`${modeLabel(v, dict)} · ${v.armed ? dict.armedState : dict.disarmedState}`}>
      {v.armed && (
        <span className="arm-mark" role="img" aria-label={dict.armedState}>
          <IconPower size={11} />
        </span>
      )}
      {modeLabel(v, dict)}
    </span>
  )
}
