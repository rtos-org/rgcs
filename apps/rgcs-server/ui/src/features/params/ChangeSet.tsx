import { useState } from 'react'
import { VerifiedMark } from './VerifiedMark'
import type { ParamEntry, ParamWriteResult } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { formatValue, rebootNeeded, type Changes } from './changes'
import { resultText } from './format'
import type { MetaMap } from './meta'
import { IconClose } from '../../shared/ui/icons'

interface Props {
  readonly changes: Changes
  readonly entries: ReadonlyMap<string, ParamEntry>
  readonly meta: MetaMap
  readonly results: readonly ParamWriteResult[] | null
  readonly armed: boolean
  /** A full download is running: the vehicle's list is in flux, writes are refused. */
  readonly downloading: boolean
  readonly busy: boolean
  readonly error: string | null
  readonly dict: Dict
  readonly onClear: (name: string) => void
  readonly onClearAll: () => void
  readonly onWrite: () => Promise<void>
}

/** The pending edits, the write button with its confirm sheet, and the last write's results. */
export function ChangeSet({ changes, entries, meta, results, armed, downloading, busy, error, dict, onClear, onClearAll, onWrite }: Props) {
  const [confirming, setConfirming] = useState(false)
  const reboot = rebootNeeded(changes, meta)
  const list = [...changes]
  const execute = async () => {
    setConfirming(false)
    await onWrite()
  }
  return (
    <div className="surface param-changes" data-testid="param-changes">
      <div className="row hair param-changes-h">
        <span className="h2">{dict.paramChanges}</span>
        <span className="t3 num">{list.length}</span>
        <span className="grow" />
        {list.length > 0 && (
          <button type="button" className="btn btn-ghost sm" onClick={onClearAll} disabled={busy}>
            {dict.paramDiscard}
          </button>
        )}
      </div>
      <div className="param-changes-body">
        {list.length === 0 && results === null && <div className="t3 params-empty">{dict.paramNoChanges}</div>}
        {list.length > 0 && (
          <ul className="param-change-list">
            {list.map(([name, value]) => {
              const m = meta[name]
              const old = entries.get(name)?.value
              return (
                <li key={name} className="row hair">
                  <div className="grow">
                    <div className="mono param-name">{name}</div>
                    <div className="num t2">
                      {old === undefined ? '?' : formatValue(old, m)} → {formatValue(value, m)}
                    </div>
                    {m?.reboot && <span className="badge reboot">{dict.paramReboot}</span>}
                  </div>
                  <button type="button" className="btn btn-ghost sm" aria-label={`${dict.paramRemove} ${name}`} onClick={() => onClear(name)} disabled={busy}>
                    <IconClose size={14} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {reboot.length > 0 && <div className="warnbox">{dict.paramRebootNote}</div>}
        {armed && list.length > 0 && <div className="warnbox">{dict.paramArmedNote}</div>}
        {downloading && list.length > 0 && <div className="warnbox">{dict.paramDownloadingNote}</div>}
        {error && <div className="warnbox fatal">{error}</div>}
        {results !== null && (
          <div className="param-results" data-testid="param-results">
            <div className="h2">{dict.paramResults}</div>
            <ul>
              {results.map((r) => (
                <li key={r.name} className={`row${r.verified ? '' : ' bad'}`}>
                  <span className="mono param-name">{r.name}</span>
                  <span className="num t2">{r.actual === null ? '–' : formatValue(r.actual, meta[r.name])}</span>
                  {meta[r.name]?.reboot && <span className="badge reboot">{dict.paramReboot}</span>}
                  <span className="grow" />
                  <span className={r.verified ? 'ok' : 'warn'}>{r.verified ? <VerifiedMark ok dict={dict} /> : resultText(r, dict)}</span>
                </li>
              ))}
            </ul>
            {results.some((r) => r.reason !== 'vehicle_armed' && meta[r.name]?.reboot) && <div className="warnbox">{dict.paramRebootHint}</div>}
          </div>
        )}
      </div>
      <div className="param-changes-f">
        <button type="button" className="btn btn-lg btn-primary" onClick={() => setConfirming(true)} disabled={busy || armed || downloading || list.length === 0}>
          {dict.paramWrite}
        </button>
      </div>
      {confirming && (
        <div className="modal-backdrop">
          <div className="g-strong confirm" role="dialog" aria-label={dict.confirmTitle}>
            <div className="h2">{dict.confirmTitle}</div>
            <div className="confirm-body">
              <span className="confirm-cmd">{dict.paramWrite}</span>
              <span className="t2">{dict.paramCount.replace('{n}', String(list.length))}</span>
              {reboot.length > 0 && <span className="t2">{dict.paramRebootNote}</span>}
            </div>
            <div className="confirm-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
                {dict.cancel}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void execute()}>
                {dict.execute}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
