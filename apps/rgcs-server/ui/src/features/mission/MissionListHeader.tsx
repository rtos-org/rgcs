import type { Dict } from '../../shared/i18n'

interface Props {
  readonly count: number
  readonly dict: Dict
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly onUndo: () => void
  readonly onRedo: () => void
  readonly onReverse: () => void
  readonly onClear: () => void
}

/** The list header: item count, undo / redo, reverse and clear. */
export function MissionListHeader({ count, dict, canUndo, canRedo, onUndo, onRedo, onReverse, onClear }: Props) {
  return (
    <div className="panel-h" style={{ gap: 6 }}>
      <span className="h1" style={{ whiteSpace: 'nowrap' }}>
        {dict.mItemsTitle}
      </span>
      <span className="h1 t2" style={{ fontWeight: 300 }}>
        {count}
      </span>
      <div className="grow" />
      <button type="button" className="btn-icon" title={`${dict.mUndo} (⌘Z)`} aria-label={dict.mUndo} disabled={!canUndo} onClick={onUndo}>
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
      </button>
      <button type="button" className="btn-icon" title={`${dict.mRedo} (⇧⌘Z)`} aria-label={dict.mRedo} disabled={!canRedo} onClick={onRedo}>
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>
      </button>
      <button type="button" className="btn-icon" title={dict.mReverse} aria-label={dict.mReverse} onClick={onReverse}>
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 7h11l-3-3M17 17H6l3 3" /></svg>
      </button>
      <button type="button" className="btn-icon" title={dict.mClearAll} aria-label={dict.mClearAll} onClick={onClear}>
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></svg>
      </button>
    </div>
  )
}
