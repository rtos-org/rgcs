import { useState } from 'react'
import type { Dict } from '../../shared/i18n'
import { IconPlus } from '../../shared/ui/icons'
import type { AreasApi, Rect } from './api'
import { AREA_MAX_TILES, areaErrorText } from './errors'

interface Props {
  readonly dict: Dict
  readonly api: AreasApi
  /** The map's view right now (null: no map). */
  readonly viewRect: () => Rect | null
  /** After a successful add: the list is read again. */
  readonly onAdded: () => void
}

interface Draft {
  readonly rect: Rect
  readonly name: string
  /** null while counting (or when the count failed). */
  readonly tiles: number | null
}

const MAX_NAME = 60

/** "Add the area in view": takes the view, shows its tile count, then a name and Fetch. */
export function AddAreaForm({ dict, api, viewRect, onAdded }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const start = () => {
    const rect = viewRect()
    setError(rect ? null : dict.ovErrNoView)
    setDraft(rect ? { rect, name: '', tiles: null } : null)
    if (!rect) return
    api.estimate(rect).then(
      (tiles) => setDraft((d) => (d && d.rect === rect ? { ...d, tiles } : d)),
      (e: unknown) => setError(areaErrorText(e, dict)),
    )
  }

  const submit = async (d: Draft) => {
    setSending(true)
    setError(null)
    try {
      await api.create({ name: d.name.trim(), ...d.rect })
      setDraft(null)
      onAdded()
    } catch (e) {
      setError(areaErrorText(e, dict))
    } finally {
      setSending(false)
    }
  }

  const name = draft?.name.trim() ?? ''
  const tooMany = draft?.tiles != null && draft.tiles > AREA_MAX_TILES
  const ready = draft !== null && draft.tiles !== null && !tooMany && name.length > 0 && name.length <= MAX_NAME && !sending
  return (
    <div className="ov-add">
      <button type="button" className="btn btn-sm" onClick={start}>
        <IconPlus size={14} />
        {dict.ovAddView}
      </button>
      {draft && (
        <div className="ov-add-form">
          <input type="text" aria-label={dict.ovName} placeholder={dict.ovName} maxLength={MAX_NAME} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <span className="num ov-add-tiles">{draft.tiles === null ? dict.ovEstimating : dict.ovTiles.replace('{n}', String(draft.tiles))}</span>
          <button type="button" className="btn btn-sm btn-primary" disabled={!ready} onClick={() => void submit(draft)}>
            {dict.ovFetch}
          </button>
        </div>
      )}
      {tooMany && <div className="multi-note danger">{dict.ovErrTooMany.replace('{max}', String(AREA_MAX_TILES))}</div>}
      {error && <div className="multi-note danger">{error}</div>}
    </div>
  )
}
