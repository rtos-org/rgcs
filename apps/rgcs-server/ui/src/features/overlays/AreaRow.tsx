import { useState } from 'react'
import type { OverlayArea } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconRefresh, IconTrash } from '../../shared/ui/icons'
import { ymd } from './layer'

interface Props {
  readonly area: OverlayArea
  readonly dict: Dict
  readonly onRefresh: (id: number) => void
  readonly onDelete: (id: number) => void
}

function statusText(a: OverlayArea, dict: Dict): string {
  switch (a.status) {
    case 'fetching':
      return dict.ovStatusFetching.replace('{done}', String(a.tiles_ok + a.tiles_failed)).replace('{total}', String(a.tiles_total))
    case 'ready':
      return dict.ovStatusReady
    case 'partial':
      return dict.ovStatusPartial
    case 'failed':
      return dict.ovStatusFailed
    default:
      return dict.ovStatusIdle
  }
}

const rectText = (a: OverlayArea): string => `${a.south.toFixed(4)}, ${a.west.toFixed(4)} / ${a.north.toFixed(4)}, ${a.east.toFixed(4)}`

/** One saved area: what was fetched and when, 更新 and 削除 (asked in place, never `window.confirm`). */
export function AreaRow({ area: a, dict, onRefresh, onDelete }: Props) {
  const [asking, setAsking] = useState(false)
  const busy = a.status === 'fetching'
  return (
    <li className={`ov-area st-${a.status}`}>
      <div className="ov-area-head">
        <span className="grow ov-area-name">{a.name}</span>
        <span className="ov-area-status">{statusText(a, dict)}</span>
      </div>
      <div className="ov-area-meta num">{rectText(a)}</div>
      <div className="ov-area-meta">
        <span>{`${dict.ovFetchedAt} ${a.fetched_at === null ? dict.ovNever : ymd(a.fetched_at)}`}</span>
        <span>{`${dict.ovDataDate} ${a.data_modified === null ? dict.ovUnknown : ymd(a.data_modified)}`}</span>
        <span>{dict.ovCounts.replace('{ok}', String(a.tiles_ok)).replace('{failed}', String(a.tiles_failed))}</span>
      </div>
      <div className="ov-area-actions">
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onRefresh(a.id)}>
          <IconRefresh />
          {dict.ovRefresh}
        </button>
        <button type="button" className="btn-icon" disabled={busy} aria-label={dict.ovDeleteNamed.replace('{name}', a.name)} title={dict.ovDelete} onClick={() => setAsking(true)}>
          <IconTrash size={14} />
        </button>
      </div>
      {asking && (
        <div className="multi-note picker-ask" role="alertdialog" aria-label={dict.ovDelete}>
          <span>{dict.ovDeleteAsk.replace('{name}', a.name)}</span>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-sm" onClick={() => setAsking(false)}>
              {dict.cancel}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => {
                setAsking(false)
                onDelete(a.id)
              }}
            >
              {dict.ovDelete}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
