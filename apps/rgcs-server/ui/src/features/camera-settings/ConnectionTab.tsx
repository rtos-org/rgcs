import type { CameraState, VideoSourceMode } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { clockDanger, clockText, sdDanger, sdText } from '../camera/mediaFormat'
import { hostFromRtsp, MT11_RTSP_URL, type CameraProfileDraft, type Issue } from './schema'

interface Props {
  readonly draft: CameraProfileDraft
  readonly issue: Issue | null
  readonly cameraState: CameraState | undefined
  readonly onChange: (next: CameraProfileDraft) => void
  /** `caps.clock_sync`: the camera can be synced (今すぐ同期 needs it and a live connection). */
  readonly clockSync: boolean
  readonly onSyncClock: () => void
  readonly dict: Dict
}

const SOURCES: readonly VideoSourceMode[] = ['auto', 'mt11']

/** A kind switch keeps the RTSP URL valid: MT11 uses its `{host}` template, MAVLink starts from the resolved one. */
export function withKind(draft: CameraProfileDraft, kind: CameraProfileDraft['kind']): CameraProfileDraft {
  if (kind === draft.kind) return draft
  if (kind === 'siyi_mt11') return { ...draft, kind, rtsp_url: MT11_RTSP_URL }
  if (kind === 'mavlink') return { ...draft, kind, rtsp_url: draft.rtsp_url.replace('{host}', draft.host) }
  return { ...draft, kind }
}

/** The RTSP URL's IPv4 host becomes the profile host (the RTSP host is the camera's address). */
const withRtsp = (draft: CameraProfileDraft, rtsp_url: string): CameraProfileDraft => ({ ...draft, rtsp_url, host: hostFromRtsp(rtsp_url) ?? draft.host })

/** Prototype 接続 tab: `.form` rows, then an `.inset .kv` status box. */
export function ConnectionTab({ draft, issue, cameraState, onChange, clockSync, onSyncClock, dict }: Props) {
  const bad = (field: string, base: string) => (issue?.path === field ? `${base} invalid` : base)
  return (
    <>
      <div className="form">
        <span>{dict.cameraKind}</span>
        <select id="cam-kind" className="in" aria-label={dict.cameraKind} value={draft.kind} onChange={(e) => onChange(withKind(draft, e.target.value as CameraProfileDraft['kind']))}>
          <option value="none">{dict.cameraKindNone}</option>
          <option value="siyi_mt11">SIYI MT11</option>
          <option value="mavlink">{dict.mavlinkCamera}</option>
        </select>
      </div>
      {draft.kind === 'siyi_mt11' && (
        <>
          <div className="form">
            <span>{dict.cameraHost}</span>
            <input id="cam-host" className={bad('host', 'in mono')} aria-label={dict.cameraHost} value={draft.host} onChange={(e) => onChange({ ...draft, host: e.target.value })} />
            <span>{dict.cameraPort}</span>
            <input id="cam-port" type="number" className={bad('port', 'in num')} aria-label={dict.cameraPort} value={draft.port} onChange={(e) => onChange({ ...draft, port: Number(e.target.value) })} />
            <span>RTSP</span>
            <span className="mono t2 ell" style={{ fontSize: 12 }}>{`rtsp://${draft.host}:8554/video1`}</span>
            <span>{dict.videoSource}</span>
            <div className="seg n3 sm" role="group" aria-label={dict.videoSource} style={{ width: 220 }}>
              <span className="lens" style={{ transform: `translateX(${SOURCES.indexOf(draft.video_source_mode) * 100}%)` }} />
              <button type="button" className={draft.video_source_mode === 'auto' ? 'on' : ''} onClick={() => onChange({ ...draft, video_source_mode: 'auto' })}>
                {dict.auto}
              </button>
              <button type="button" className={draft.video_source_mode === 'mt11' ? 'on' : ''} onClick={() => onChange({ ...draft, video_source_mode: 'mt11' })}>
                MT11
              </button>
              <button type="button" aria-disabled="true" title={dict.comingSoon} className="off">
                {dict.auxSource}
              </button>
            </div>
          </div>
          <StatusBox cameraState={cameraState} canSync={clockSync && cameraState?.connected === true} onSyncClock={onSyncClock} dict={dict} />
        </>
      )}
      {draft.kind === 'mavlink' && (
        <>
          <div className="form">
            <span>{dict.compId}</span>
            <input id="cam-comp-id" type="number" className={bad('comp_id', 'in num')} aria-label={dict.compId} value={draft.comp_id} onChange={(e) => onChange({ ...draft, comp_id: Number(e.target.value) })} />
            <span>{dict.rtspUrl}</span>
            <input id="cam-rtsp" className={bad('rtsp_url', 'in mono')} aria-label={dict.rtspUrl} value={draft.rtsp_url} onChange={(e) => onChange(withRtsp(draft, e.target.value))} />
          </div>
          <MavlinkStatusBox cameraState={cameraState} dict={dict} />
        </>
      )}
      {issue && <span className="danger settings-issue">{issue.path}: {issue.message}</span>}
    </>
  )
}

/** The MAVLink `.inset .kv` box: connection and the camera firmware (no SD / clock). */
function MavlinkStatusBox({ cameraState, dict }: { readonly cameraState: CameraState | undefined; readonly dict: Dict }) {
  const fw = cameraState?.firmware
  return (
    <div className="inset" style={{ padding: '12px 14px' }}>
      <div className="kv">
        <span>{dict.camConn}</span>
        <ConnText connected={cameraState?.connected === true} dict={dict} />
        <span>{dict.camFw}</span>
        <span className="mono" style={{ fontSize: 12 }}>
          {fw?.camera ? `cam ${fw.camera}` : dict.unknown}
        </span>
      </div>
    </div>
  )
}

function ConnText({ connected, dict }: { readonly connected: boolean; readonly dict: Dict }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className={`dot ${connected ? 'ok' : 'lost'}`} style={{ width: 8, height: 8 }} />
      {connected ? dict.camConnected : dict.disconnected}
    </span>
  )
}

interface StatusProps {
  readonly cameraState: CameraState | undefined
  readonly canSync: boolean
  readonly onSyncClock: () => void
  readonly dict: Dict
}

const dangerStyle = (on: boolean) => (on ? { color: 'var(--danger)' } : undefined)

/** The `.inset .kv` status box: connection, firmware, SD card, camera clock + 今すぐ同期. */
function StatusBox({ cameraState, canSync, onSyncClock, dict }: StatusProps) {
  const fw = cameraState?.firmware
  const storage = cameraState?.storage
  const clock = cameraState?.clock
  return (
    <div className="inset" style={{ padding: '12px 14px' }}>
      <div className="kv">
        <span>{dict.camConn}</span>
        <ConnText connected={cameraState?.connected === true} dict={dict} />
        <span>{dict.camFw}</span>
        <span className="mono" style={{ fontSize: 12 }}>
          {fw ? `cam ${fw.camera} gimbal ${fw.gimbal} zoom ${fw.zoom}` : dict.unknown}
        </span>
        <span>{dict.camSd}</span>
        <span style={dangerStyle(sdDanger(storage))}>{sdText(storage, dict) ?? dict.unknown}</span>
        <span>{dict.camClock}</span>
        <span className="row" style={{ gap: 10 }}>
          <span style={dangerStyle(clockDanger(clock))}>{clockText(clock, dict)}</span>
          <button type="button" className="btn btn-sm" disabled={!canSync} onClick={onSyncClock}>
            {dict.syncNow}
          </button>
        </span>
      </div>
    </div>
  )
}
