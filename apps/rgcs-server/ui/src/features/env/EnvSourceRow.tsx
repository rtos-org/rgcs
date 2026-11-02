// One 外的要因 source: enable switch, interval / timeout, last fetch (local time), 成功 / 失敗 + error,
// next due, 今すぐ取得, the terms line and, for keyed sources, only the key's hint. No key input exists.
import { useState } from 'react'
import { z } from 'zod'
import { ApiError } from '../../shared/api/client'
import type { EnvSourceStatus } from '../../shared/api/types'
import { hhmmss } from '../../shared/format/time'
import type { Dict } from '../../shared/i18n'
import { IconRefresh } from '../../shared/ui/icons'
import { fetchNow, putEnvSource, type EnvSourcePut } from './api'

interface Props {
  readonly status: EnvSourceStatus
  readonly isAdmin: boolean
  readonly dict: Dict
  readonly onChange: (next: EnvSourceStatus) => void
}

const numbers = z.object({ interval_s: z.number().int().min(60).max(86_400), timeout_ms: z.number().int().min(1000).max(30_000) })

const lookup = (dict: Dict, key: string): string | undefined => (dict as Record<string, string | undefined>)[key]

export const sourceTitle = (s: EnvSourceStatus, dict: Dict) => lookup(dict, `envSrc_${s.id}`) ?? s.label
export const sourceTerms = (s: EnvSourceStatus, dict: Dict) => lookup(dict, `envTerms_${s.id.startsWith('swpc') ? 'swpc' : s.id}`) ?? s.terms

/** A fetch error code (`timeout`, `http_503`, …) in the user's language. */
export function errorText(code: string, dict: Dict): string {
  const http = code.match(/^http_(\d+)$/)
  if (http) return `HTTP ${http[1]}`
  return lookup(dict, `env_err_${code}`) ?? code
}

function statusText(s: EnvSourceStatus, dict: Dict): string {
  if (s.last_error) return `${dict.envFailed} ${errorText(s.last_error, dict)}${s.last_ok_ms ? ` (${dict.envOk} ${hhmmss(s.last_ok_ms)})` : ''}`
  return s.last_ok_ms ? `${dict.envOk} ${hhmmss(s.last_ok_ms)}` : dict.envNever
}

export function EnvSourceRow({ status, isAdmin, dict, onChange }: Props) {
  const [intervalDraft, setIntervalDraft] = useState<string | null>(null)
  const [timeoutDraft, setTimeoutDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState<string | null>(null)
  const title = sourceTitle(status, dict)
  const run = async (call: () => Promise<EnvSourceStatus>): Promise<boolean> => {
    setBusy(true)
    setIssue(null)
    try {
      onChange(await call())
      return true
    } catch (e: unknown) {
      setIssue(e instanceof ApiError ? errorText(e.code, dict) : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  const put = (body: EnvSourcePut) => run(() => putEnvSource(status.id, body))
  const saveNumbers = async () => {
    const parsed = numbers.safeParse({ interval_s: Number(intervalDraft ?? status.interval_s), timeout_ms: Number(timeoutDraft ?? status.timeout_ms) })
    if (!parsed.success) return setIssue(dict.envRange)
    if (await put(parsed.data)) {
      setIntervalDraft(null)
      setTimeoutDraft(null)
    }
  }
  const tone = status.last_error !== null ? ' bad' : status.last_ok_ms === null ? ' never' : ''
  return (
    <div className={status.enabled ? 'inset env-src' : 'inset env-src off'} data-testid={`env-src-${status.id}`}>
      <div className="env-src-main">
        <div className="row env-src-head">
          <button type="button" className="switch" role="switch" aria-checked={status.enabled} aria-label={title} disabled={!isAdmin || busy} onClick={() => void put({ enabled: !status.enabled })}>
            <span className="knob" />
          </button>
          <span className="env-src-title" data-testid="env-src-title">
            {title}
          </span>
        </div>
        <div className="t3 env-src-terms">{sourceTerms(status, dict)}</div>
        <div className="t3 env-src-terms">
          {status.uses_location ? dict.envUsesLocation : dict.envNoLocation}
          {status.needs_key && <span className="env-src-key mono"> · {status.key_configured ? dict.envKeySet.replace('{hint}', status.key_hint ?? '…') : dict.envKeyNone}</span>}
        </div>
      </div>
      <div className="env-src-nums">
        <NumField id={`env-${status.id}-interval`} label={dict.envInterval} value={intervalDraft ?? String(status.interval_s)} disabled={!isAdmin} onChange={setIntervalDraft} />
        <NumField id={`env-${status.id}-timeout`} label={dict.envTimeout} value={timeoutDraft ?? String(status.timeout_ms)} disabled={!isAdmin} onChange={setTimeoutDraft} />
        {isAdmin && (
          <button type="button" className="btn btn-sm" disabled={busy || (intervalDraft === null && timeoutDraft === null)} onClick={() => void saveNumbers()}>
            {dict.save}
          </button>
        )}
      </div>
      <div className="env-src-state">
        <div className={`env-src-status${tone}`} data-testid="env-src-status">
          {statusText(status, dict)}
        </div>
        <div className="t3 env-src-next" data-testid="env-src-next">
          {dict.envNext} {status.next_due_ms ? hhmmss(status.next_due_ms) : '—'}
        </div>
        {isAdmin && (
          <button type="button" className="btn btn-sm btn-ghost env-fetch" disabled={busy} onClick={() => void run(() => fetchNow(status.id))}>
            <IconRefresh />
            {dict.envFetchNow}
          </button>
        )}
      </div>
      {issue && <div className="settings-issue env-src-issue">{issue}</div>}
    </div>
  )
}

function NumField(p: { readonly id: string; readonly label: string; readonly value: string; readonly disabled: boolean; readonly onChange: (v: string) => void }) {
  return (
    <div className="env-num">
      <label htmlFor={p.id} className="t3">
        {p.label}
      </label>
      <input id={p.id} type="number" className="in num" value={p.value} disabled={p.disabled} onChange={(e) => p.onChange(e.target.value)} />
    </div>
  )
}
