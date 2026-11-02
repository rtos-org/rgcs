import type { Dict } from '../../shared/i18n'
import { IconScan } from '../../shared/ui/icons'

/** 「全機を表示」: frames every vehicle with a position; placed under the map type button. */
export function ShowAllButton({ dict, onClick, className }: { readonly dict: Dict; readonly onClick: () => void; readonly className: string }) {
  return (
    <button type="button" className={`g-ctl btn-icon show-all ${className}`} aria-label={dict.showAll} title={dict.showAll} onClick={onClick}>
      <IconScan size={18} />
    </button>
  )
}
