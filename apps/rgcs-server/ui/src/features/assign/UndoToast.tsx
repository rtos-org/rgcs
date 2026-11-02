// The assignment board's undo toast (spec 2026-10-31 §4): every assign, replace, move and
// unassign says what it did, with 元に戻す for UNDO_MS. A new action replaces the toast and
// restarts its clock. Undo puts each vehicle's previous plan back through the store.
import { useEffect } from 'react'
import type { Dict } from '../../shared/i18n'
import { IconUndo } from '../../shared/ui/icons'
import type { Undo } from './undo'

export const UNDO_MS = 4500

export interface UndoToastProps {
  readonly undo: Undo | null
  readonly dict: Dict
  readonly onUndo: (undo: Undo) => void
  readonly onClose: () => void
}

export function UndoToast({ undo, dict, onUndo, onClose }: UndoToastProps) {
  useEffect(() => {
    if (undo === null) return
    const timer = setTimeout(onClose, UNDO_MS)
    return () => clearTimeout(timer)
  }, [undo, onClose])

  if (undo === null) return null
  return (
    <div className="g as-toast" role="status" aria-live="polite">
      <span>{undo.text}</span>
      <button type="button" className="btn as-undo" onClick={() => onUndo(undo)}>
        <IconUndo />
        {dict.asUndo}
      </button>
    </div>
  )
}
