import type { Dict } from '../../shared/i18n'
import { IconClose } from '../../shared/ui/icons'

interface Props {
  readonly name: string
  readonly onClear: () => void
  readonly dict: Dict
}

/** "追従中 UAV-01 ×" (x icon) at the top centre of the map. */
export function FollowChip({ name, onClear, dict }: Props) {
  return (
    <div className="hint caution float map-c top1 follow-chip">
      {dict.following} {name}
      <button type="button" className="chip-x" aria-label={dict.unfollow} onClick={onClear}>
        <IconClose size={14} />
      </button>
    </div>
  )
}
