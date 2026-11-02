import type { Dict } from '../../shared/i18n'
import type { ContextMenu as Menu } from './mapEdit'

interface Props {
  readonly menu: Menu
  readonly dict: Dict
  readonly onInsert: (uid: number) => void
  readonly onDelete: (uid: number) => void
  readonly onBulkAlt: () => void
  readonly onClose: () => void
}

/** Right-click menu on a waypoint badge: 挿入 / 削除 / 高度一括. */
export function ContextMenu({ menu, dict, onInsert, onDelete, onBulkAlt, onClose }: Props) {
  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }
  return (
    <div className="ctx-menu g-strong" role="menu" style={{ left: menu.x, top: menu.y }}>
      <button type="button" role="menuitem" onClick={run(() => onInsert(menu.uid))}>
        {dict.mInsertAfter}
      </button>
      <button type="button" role="menuitem" onClick={run(onBulkAlt)}>
        {dict.mBulkAlt}
      </button>
      <button type="button" role="menuitem" className="danger" onClick={run(() => onDelete(menu.uid))}>
        {dict.mDeleteItem}
      </button>
    </div>
  )
}
