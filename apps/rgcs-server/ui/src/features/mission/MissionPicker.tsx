import { useEffect, useState } from 'react'
import type { MissionSummaryRow } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { ymdHm } from '../../shared/format/time'
import { listMissions } from './api'
import { IconClose, IconTrash } from '../../shared/ui/icons'

type Load = () => Promise<MissionSummaryRow[]>

interface Props {
  readonly dict: Dict
  readonly title: string
  readonly onPick: (row: MissionSummaryRow) => void
  readonly onClose: () => void
  readonly load?: Load
  /** Deletes a saved plan after the in-sheet question; resolves true when it is gone (absent: no delete buttons). */
  readonly onDelete?: (row: MissionSummaryRow) => Promise<boolean>
}

/** The saved missions from the server: null while loading. */
export function useSavedMissions(load: Load): { readonly rows: MissionSummaryRow[] | null; readonly error: string | null } {
  const [rows, setRows] = useState<MissionSummaryRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    load()
      .then((r) => alive && setRows(r))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [load])
  return { rows, error }
}

export function PickerHead({ title, dict, onClose }: { readonly title: string; readonly dict: Dict; readonly onClose: () => void }) {
  return (
    <div className="panel-h">
      <span className="h1">{title}</span>
      <span className="grow" />
      <button type="button" className="btn-icon" aria-label={dict.close} onClick={onClose}>
        <IconClose />
      </button>
    </div>
  )
}

export const rowMeta = (r: MissionSummaryRow, dict: Dict): string => `${r.item_count} ${dict.mItems} · ${ymdHm(r.updated_at)}`

/** Saved missions as a sheet; 開く in the editor (a click opens: nothing is sent to a vehicle). */
export function MissionPicker({ dict, title, onPick, onClose, load = listMissions, onDelete }: Props) {
  const { rows: loaded, error } = useSavedMissions(load)
  const [gone, setGone] = useState<ReadonlySet<number>>(new Set())
  const [asking, setAsking] = useState<MissionSummaryRow | null>(null)
  const rows = loaded?.filter((r) => !gone.has(r.id)) ?? null
  const confirm = async (row: MissionSummaryRow) => {
    setAsking(null)
    if (onDelete && (await onDelete(row))) setGone((g) => new Set([...g, row.id]))
  }
  return (
    <aside className="g-strong sheet" aria-label={title} role="dialog">
      <PickerHead title={title} dict={dict} onClose={onClose} />
      {error && <div className="multi-note danger">{error}</div>}
      {rows && rows.length === 0 && <div className="multi-note">{dict.mNoSaved}</div>}
      {asking && <DeleteAsk name={asking.name} dict={dict} onCancel={() => setAsking(null)} onConfirm={() => void confirm(asking)} />}
      {rows && rows.length > 0 && (
        <ul className="mission-picker">
          {rows.map((r) => (
            <li key={r.id} className="picker-row">
              <button type="button" className="picker-open" onClick={() => onPick(r)}>
                <span className="grow">{r.name}</span>
                <span className="meta num">{rowMeta(r, dict)}</span>
              </button>
              {onDelete && (
                <button type="button" className="btn-icon picker-del" aria-label={dict.mDeleteNamed.replace('{name}', r.name)} onClick={() => setAsking(r)}>
                  <IconTrash size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}

function DeleteAsk({ name, dict, onCancel, onConfirm }: { readonly name: string; readonly dict: Dict; readonly onCancel: () => void; readonly onConfirm: () => void }) {
  return (
    <div className="multi-note picker-ask" role="alertdialog" aria-label={dict.mDeleteYes}>
      <span>{dict.mDeleteAsk.replace('{name}', name)}</span>
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          {dict.cancel}
        </button>
        <button type="button" className="btn btn-sm btn-danger" onClick={onConfirm}>
          {dict.mDeleteYes}
        </button>
      </div>
    </div>
  )
}
