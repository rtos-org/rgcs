// 「ミッション書込」 from the ops detail panel: a click only selects a saved mission; the
// footer button asks in-app, naming the mission and the vehicle, before anything is written.
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MissionSummaryRow } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconUpload } from '../../shared/ui/icons'
import { useConfirmKeys } from '../commands/confirmKeys'
import { listMissions } from './api'
import { PickerHead, rowMeta, useSavedMissions } from './MissionPicker'

interface Props {
  readonly vehicleName: string
  readonly dict: Dict
  readonly onWrite: (row: MissionSummaryRow) => void
  readonly onClose: () => void
  readonly load?: () => Promise<MissionSummaryRow[]>
}

export function MissionWriteSheet({ vehicleName, dict, onWrite, onClose, load = listMissions }: Props) {
  const { rows, error } = useSavedMissions(load)
  const [picked, setPicked] = useState<number | null>(null)
  const [asking, setAsking] = useState(false)
  const row = rows?.find((r) => r.id === picked) ?? null
  return (
    <aside className="g-strong sheet" aria-label={dict.mWriteMission} role="dialog">
      <PickerHead title={dict.mWriteMission} dict={dict} onClose={onClose} />
      {error && <div className="multi-note danger">{error}</div>}
      {rows && rows.length === 0 && <div className="multi-note">{dict.mNoSaved}</div>}
      {rows && rows.length > 0 && (
        <ul className="mission-picker" role="listbox" aria-label={dict.mSaved}>
          {rows.map((r) => (
            <li key={r.id} role="option" aria-selected={r.id === picked} className={r.id === picked ? 'on' : undefined} onClick={() => setPicked(r.id)}>
              <span>{r.name}</span>
              <span className="meta num">{rowMeta(r, dict)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="grow" />
      <div className="hair-t mission-write-foot">
        <button type="button" className="btn btn-lg btn-primary" disabled={row === null} onClick={() => setAsking(true)}>
          <IconUpload />
          {dict.mWriteTo.replace('{name}', vehicleName)}
        </button>
      </div>
      {asking && row && (
        <WriteConfirm
          mission={row.name}
          vehicleName={vehicleName}
          dict={dict}
          onCancel={() => setAsking(false)}
          onWrite={() => {
            setAsking(false)
            onWrite(row)
          }}
        />
      )}
    </aside>
  )
}

interface ConfirmProps {
  readonly mission: string
  readonly vehicleName: string
  readonly dict: Dict
  readonly onCancel: () => void
  readonly onWrite: () => void
}

/** The standard confirm (ConfirmDialog's look): what is written, to which vehicle. Portalled to the
 * body: the sheet's backdrop filter would otherwise confine the full-screen backdrop to the sheet. */
function WriteConfirm({ mission, vehicleName, dict, onCancel, onWrite }: ConfirmProps) {
  const box = useRef<HTMLDivElement>(null)
  useConfirmKeys(box, onWrite, onCancel)
  return createPortal(
    <div className="modal-backdrop">
      <div ref={box} className="g-strong confirm" role="alertdialog" aria-label={dict.mWriteAsk}>
        <div className="h2">{dict.mWriteAsk}</div>
        <div className="confirm-body">
          <span className="confirm-cmd">{mission}</span>
          <span className="t2">{`→ ${vehicleName}`}</span>
        </div>
        <div className="confirm-ctx t2">{dict.mWriteReplaces}</div>
        <div className="confirm-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {dict.cancel}
          </button>
          <button type="button" className="btn btn-primary" onClick={onWrite}>
            {dict.mWriteGo}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
