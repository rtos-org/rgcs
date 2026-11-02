import { useState } from 'react'
import { ApiError } from '../../shared/api/client'
import { saveMavlinkSettings, useAppSettings } from '../../shared/api/settings'
import type { Dict } from '../../shared/i18n'

type Status = 'idle' | 'saving' | 'saved' | 'range' | 'in_use' | 'failed'

/** MAVLink (user request 2026-10-19): the RGCS's own SYSID, admin only. */
export function MavlinkCard({ dict, isAdmin }: { readonly dict: Dict; readonly isAdmin: boolean }) {
  const settings = useAppSettings()
  const [draft, setDraft] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const current = settings?.mavlink.gcs_sysid ?? 255
  const text = draft ?? String(current)
  const save = () => {
    const value = Number(text)
    if (!Number.isInteger(value) || value < 1 || value > 255) return setStatus('range')
    setStatus('saving')
    saveMavlinkSettings({ gcs_sysid: value })
      .then(() => {
        setDraft(null)
        setStatus('saved')
      })
      .catch((e: unknown) => setStatus(e instanceof ApiError && e.code === 'sysid_in_use' ? 'in_use' : 'failed'))
  }
  const message = { idle: '', saving: '', saved: dict.gcsSysidSaved, range: dict.gcsSysidRange, in_use: dict.gcsSysidInUse, failed: dict.failed }[status]
  return (
    <div className="surface" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="mavlink-card">
      <div className="h1">MAVLink</div>
      <div className="setrow">
        <div>
          <label htmlFor="gcs-sysid" style={{ fontSize: 14, fontWeight: 500 }}>
            {dict.gcsSysid}
          </label>
          <div className="t3" style={{ fontSize: 12, marginTop: 3 }}>
            {dict.gcsSysidNote}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input id="gcs-sysid" type="number" min={1} max={255} className="in num" style={{ width: 88 }} value={text} disabled={!isAdmin || settings === null} onChange={(e) => setDraft(e.target.value)} />
          <button type="button" className="btn" disabled={!isAdmin || status === 'saving' || draft === null} onClick={save}>
            {dict.save}
          </button>
        </div>
      </div>
      {message && <div className={status === 'saved' ? 't3' : 'hint caution'}>{message}</div>}
    </div>
  )
}
