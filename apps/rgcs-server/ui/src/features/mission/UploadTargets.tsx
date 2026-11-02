import { useState } from 'react'
import type { Dict } from '../../shared/i18n'
import { IconClose } from '../../shared/ui/icons'

interface Target {
  readonly sysid: number
  readonly name: string
}

interface Props {
  readonly vehicles: readonly Target[]
  /** The mission's own vehicle: ticked to start with. */
  readonly target: number | null
  readonly dict: Dict
  readonly onWrite: (sysids: readonly number[]) => void
  readonly onClose: () => void
}

/** 機体に書き込む with several vehicles connected: pick which ones get the mission. */
export function UploadTargets({ vehicles, target, dict, onWrite, onClose }: Props) {
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set(target === null ? [] : [target]))
  const toggle = (sysid: number) => setPicked((s) => (s.has(sysid) ? new Set([...s].filter((x) => x !== sysid)) : new Set([...s, sysid])))
  const chosen = vehicles.map((v) => v.sysid).filter((id) => picked.has(id))
  return (
    <aside className="g-strong sheet up-sheet" aria-label={dict.upTitle} role="dialog">
      <div className="panel-h">
        <span className="h1">{dict.upTitle}</span>
        <span className="grow" />
        <button type="button" className="btn-icon" aria-label={dict.close} onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="row up-bulk">
        <button type="button" className="btn" onClick={() => setPicked(new Set(vehicles.map((v) => v.sysid)))}>
          {dict.upAll}
        </button>
        <button type="button" className="btn" onClick={() => setPicked(new Set())}>
          {dict.upNone}
        </button>
      </div>
      <ul className="up-list">
        {vehicles.map((v) => (
          <li key={v.sysid}>
            <label>
              <input type="checkbox" checked={picked.has(v.sysid)} onChange={() => toggle(v.sysid)} />
              <span>{v.name}</span>
              {v.sysid === target && <span className="t3 up-tag">{dict.upTarget}</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="up-foot">
        <button type="button" className="btn btn-primary" disabled={chosen.length === 0} onClick={() => onWrite(chosen)}>
          {dict.upWriteN.replace('{n}', String(chosen.length))}
        </button>
      </div>
    </aside>
  )
}
