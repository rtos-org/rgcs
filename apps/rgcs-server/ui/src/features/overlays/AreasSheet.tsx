import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Dict } from '../../shared/i18n'
import { IconClose } from '../../shared/ui/icons'
import { areasApi, type AreasApi, type Rect } from './api'
import { areasHub, areasOf, useAreas, type AreasHub } from './areasHub'
import { areaErrorText } from './errors'
import { AddAreaForm } from './AddAreaForm'
import { AreaRow } from './AreaRow'
import { viewRectOf, type MapKey } from './mapRegistry'
import { pickText, type ActiveOverlay } from './plugins'

interface Props {
  readonly dict: Dict
  /** The `area` overlay whose areas are managed. */
  readonly target: ActiveOverlay
  /** The map whose view "Add the area in view" takes. */
  readonly mapKey: MapKey
  readonly onClose: () => void
  readonly api?: AreasApi
  readonly hub?: AreasHub
  readonly viewRect?: () => Rect | null
}

/** "Manage areas…": an overlay's saved areas (progress, dates, refresh / delete) and adding the area in view. */
export function AreasSheet({ dict, target, mapKey, onClose, api, hub = areasHub(), viewRect }: Props) {
  const calls = api ?? areasApi(target.ref)
  const all = useAreas([target.ref], hub)
  const state = areasOf(all, target.key)
  const [error, setError] = useState<string | null>(null)
  const ref = target.ref
  useEffect(() => void hub.reload(ref), [hub, ref])

  const act = async (call: () => Promise<unknown>) => {
    setError(null)
    try {
      await call()
    } catch (e) {
      setError(areaErrorText(e, dict))
    }
    await hub.reload(ref)
  }

  const title = pickText(target.overlay.name, dict.langCode)
  return createPortal(
    <aside className="g-strong sheet ov-sheet" role="dialog" aria-label={title}>
      <div className="row ov-sheet-head">
        <h3 className="grow">{title}</h3>
        <button type="button" className="btn-icon" aria-label={dict.close} onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="sheet-body">
        {state.error && <div className="multi-note danger">{dict.ovErrLoad}</div>}
        {error && <div className="multi-note danger">{error}</div>}
        {state.loaded && state.areas.length === 0 && <div className="multi-note">{dict.ovNoAreas}</div>}
        {state.areas.length > 0 && (
          <ul className="ov-areas">
            {state.areas.map((a) => (
              <AreaRow key={a.id} area={a} dict={dict} onRefresh={(id) => void act(() => calls.refresh(id))} onDelete={(id) => void act(() => calls.remove(id))} />
            ))}
          </ul>
        )}
        <AddAreaForm dict={dict} api={calls} viewRect={viewRect ?? (() => viewRectOf(mapKey))} onAdded={() => void hub.reload(ref)} />
      </div>
    </aside>,
    document.body,
  )
}
