// The 3-part in-app consent dialog for 実験機能 › AI 緊急介入. Each permission
// is its own unticked checkbox; 1 is required, 2 and 3 are granted separately. Never `window.confirm`.
import { useState } from 'react'
import type { Dict } from '../../shared/i18n'
import { IconInfo, IconShieldAlert } from '../../shared/ui/icons'
import type { ConsentAnswer } from './api'

interface Props {
  readonly dict: Dict
  readonly onConsent: (c: ConsentAnswer) => void
  readonly onCancel: () => void
  /** Ticks to start from when reviewing an earlier consent; a first enable starts with none. */
  readonly initial?: { readonly external_data: boolean; readonly auto_ops: boolean; readonly monitoring: boolean }
  /** The confirm button's label (default 同意して有効にする). */
  readonly confirmLabel?: string
  readonly busy?: boolean
}

type Key = 'monitoring' | 'external_data' | 'auto_ops'

interface Item {
  readonly key: Key
  readonly text: string
  readonly risk: string
  readonly required: boolean
}

export function ConsentDialog({ dict, onConsent, onCancel, initial, confirmLabel, busy = false }: Props) {
  const [ticks, setTicks] = useState<Record<Key, boolean>>({
    monitoring: initial?.monitoring ?? false,
    external_data: initial?.external_data ?? false,
    auto_ops: initial?.auto_ops ?? false,
  })
  const items: readonly Item[] = [
    { key: 'monitoring', text: dict.consentMonitoring, risk: dict.consentMonitoringRisk, required: true },
    { key: 'external_data', text: dict.consentExternal, risk: dict.consentExternalRisk, required: false },
    { key: 'auto_ops', text: dict.consentAutoOps, risk: dict.consentAutoOpsRisk, required: false },
  ]
  const toggle = (k: Key) => setTicks((cur) => ({ ...cur, [k]: !cur[k] }))
  const submit = () => {
    if (!ticks.monitoring) return
    onConsent({ monitoring: true, external_data: ticks.external_data, auto_ops: ticks.auto_ops })
  }
  return (
    <div className="modal-backdrop consent-backdrop">
      <div
        className="g-strong confirm consent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <div className="row consent-head">
          <IconShieldAlert size={18} className="consent-icon" />
          <div className="h2" id="consent-title">
            {dict.consentTitle}
          </div>
        </div>
        <div className="t2 consent-intro">{dict.consentIntro}</div>
        <ol className="consent-list">
          {items.map((it, i) => (
            <ConsentItem key={it.key} n={i + 1} item={it} on={ticks[it.key]} dict={dict} onToggle={() => toggle(it.key)} />
          ))}
        </ol>
        <div className="warnbox consent-admin">
          <IconInfo size={14} />
          <span>{dict.consentAdminOnly}</span>
        </div>
        <div className="confirm-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {dict.cancel}
          </button>
          <button type="button" className="btn btn-primary" disabled={!ticks.monitoring || busy} onClick={submit}>
            {confirmLabel ?? dict.consentAgree}
          </button>
        </div>
      </div>
    </div>
  )
}

function ConsentItem(p: { readonly n: number; readonly item: Item; readonly on: boolean; readonly dict: Dict; readonly onToggle: () => void }) {
  const { n, item, on, dict, onToggle } = p
  const id = `consent-${item.key}`
  return (
    <li className={on ? 'inset consent-item on' : 'inset consent-item'}>
      <input id={id} type="checkbox" checked={on} aria-describedby={`${id}-risk`} onChange={onToggle} />
      <div className="consent-copy">
        <div className="row consent-line">
          <span className="consent-n mono">{n}</span>
          <label htmlFor={id} className="consent-text">
            {item.text}
          </label>
        </div>
        <div className="row consent-meta">
          <span className={item.required ? 'consent-tag req' : 'consent-tag'}>{item.required ? dict.consentRequired : dict.consentOptional}</span>
          <span id={`${id}-risk`} className="t3 consent-risk">
            {item.risk}
          </span>
        </div>
      </div>
    </li>
  )
}
