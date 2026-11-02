import { useState } from 'react'
import { saveMapSettings, useAppSettings } from '../../shared/api/settings'
import type { Dict } from '../../shared/i18n'

/** 地図表示 (prototype app tab): the ジンバルを地面に投影 switch and the track length, saved on the server. */
export function MapDisplayCard({ dict }: { readonly dict: Dict }) {
  const settings = useAppSettings()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const on = settings?.map.gimbal_ground_projection ?? false
  const toggle = () => {
    setBusy(true)
    setFailed(false)
    saveMapSettings({ gimbal_ground_projection: !on })
      .catch(() => setFailed(true))
      .finally(() => setBusy(false))
  }
  return (
    <div className="surface" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="map-display-card">
      <div className="h1">{dict.mapDisplay}</div>
      <div className="setrow">
        <div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{dict.camProject}</div>
          <div className="t3" style={{ fontSize: 12, marginTop: 3 }}>
            {dict.camProjectNote}
          </div>
          {failed && (
            <div className="hint caution" style={{ marginTop: 6 }}>
              {dict.camProject} {dict.failed}
            </div>
          )}
        </div>
        <button type="button" className="switch" role="switch" aria-checked={on} aria-label={dict.camProject} title={dict.camProject} disabled={busy || settings === null} onClick={toggle}>
          <span className="knob" />
        </button>
      </div>
      <TrackMinutesRow dict={dict} current={settings?.map.track_minutes ?? null} />
    </div>
  )
}

type Status = 'idle' | 'saving' | 'saved' | 'range' | 'failed'

/** 軌跡を残す時間: how many minutes of flight track the maps keep (0 = none, at most 120). */
function TrackMinutesRow({ dict, current }: { readonly dict: Dict; readonly current: number | null }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const text = draft ?? (current === null ? '' : String(current))
  const save = () => {
    const value = Number(text)
    if (text.trim() === '' || !Number.isInteger(value) || value < 0 || value > 120) return setStatus('range')
    setStatus('saving')
    saveMapSettings({ track_minutes: value })
      .then(() => {
        setDraft(null)
        setStatus('saved')
      })
      .catch(() => setStatus('failed'))
  }
  const message = { idle: '', saving: '', saved: dict.trackMinutesSaved, range: dict.trackMinutesRange, failed: dict.failed }[status]
  return (
    <>
      <div className="setrow">
        <div>
          <label htmlFor="track-minutes" style={{ fontSize: 14, fontWeight: 500 }}>
            {dict.trackMinutes}
          </label>
          <div className="t3" style={{ fontSize: 12, marginTop: 3 }}>
            {dict.trackMinutesNote}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input id="track-minutes" type="number" min={0} max={120} className="in num" style={{ width: 88 }} value={text} disabled={current === null} onChange={(e) => setDraft(e.target.value)} />
          <button type="button" className="btn" disabled={status === 'saving' || draft === null} onClick={save}>
            {dict.save}
          </button>
        </div>
      </div>
      {message && <div className={status === 'saved' ? 't3' : 'hint caution'}>{message}</div>}
    </>
  )
}
