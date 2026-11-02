import { useRef, type ReactNode } from 'react'
import { KindIcon } from '../../shared/ui/KindIcon'
import type { CameraCommand, CameraSnapshot, RoiStatus, RoiTarget, VehicleState, VideoSourceStatus } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconMinimize, IconVideoOff, IconWarn } from '../../shared/ui/icons'
import { isLive, recDuration, useCameraProfile, useRecElapsed, useWhepFeed } from '../camera'
import { StatLine } from './StatLine'
import { ModeBadge } from '../vehicles/ModeBadge'
import { CamBar } from './CamBar'
import { CamCard } from './CamCard'
import { latencyText } from './cockpitView'
import { knownStream } from './geometry'
import { roiText } from '../roi/format'
import { encodingLabel } from '../camera/mediaFormat'
import { VideoOverlay } from './VideoOverlay'
import { useCoverRect } from './useCoverRect'
import { useAiAckLog, useOverlayClicks } from './useOverlayClicks'

interface Props {
  readonly vehicle: VehicleState
  readonly camera: CameraSnapshot | undefined
  readonly status: VideoSourceStatus | undefined
  readonly pending: boolean
  readonly dict: Dict
  readonly onCommand: (cmd: CameraCommand) => void
  readonly onSettings: () => void
  readonly onRestore: () => void
  /** The mini map (the operations map's layers, centred on this vehicle). */
  readonly map: ReactNode
  /** The vehicle's saved GPS ROI presets and its live ROI status (absent = off). */
  readonly roiTargets?: readonly RoiTarget[]
  readonly roiStatus?: RoiStatus
  readonly onRoiStart?: (id: string) => void
  readonly onRoiStop?: () => void
}

const NO_TARGETS: readonly RoiTarget[] = []
/** Camera profile defaults while the profile is loading. */
const DEFAULT_BOX_PX = 100

/** Clicks do something only with AI tracking / point temperature, and never in 2画面. */
function isClickable(camera: CameraSnapshot | undefined): boolean {
  if (!camera || camera.state.video_mode === 'side_by_side') return false
  return camera.caps.ai_tracking !== null || camera.caps.thermal?.point_temp === true
}

/** The maximised video (prototype `isVideoMax`): video 2.6fr, mini map + camera card 1fr. */
export function Cockpit({ vehicle: v, camera, status, pending, dict, onCommand, onSettings, onRestore, map, roiTargets = NO_TARGETS, roiStatus, onRoiStart, onRoiStop }: Props) {
  const live = isLive(status)
  const { ref, latency } = useWhepFeed(v.sysid, live)
  const has = camera !== undefined && camera.caps.kind !== 'none'
  const recording = camera?.state.recording ?? 'idle'
  const elapsedMs = useRecElapsed(recording)
  const source = (status?.source ?? 'none').toUpperCase()
  const delay = latencyText(latency)
  const activeId = roiStatus?.active_target ?? null
  const active = activeId === null ? undefined : roiTargets.find((r) => r.id === activeId)
  const roi = onRoiStart && onRoiStop ? { targets: roiTargets, activeId, onStart: onRoiStart, onStop: onRoiStop } : undefined
  const profile = useCameraProfile(has ? v.sysid : null)
  const boxPx = profile?.ai_box_px ?? DEFAULT_BOX_PX
  const layerRef = useRef<HTMLDivElement>(null)
  const rect = useCoverRect(layerRef, ref, live, knownStream(camera?.state.stream ?? null))
  const { preview, onClick } = useOverlayClicks({ sysid: v.sysid, camera, boxPx, dict, onCommand, videoRef: ref })
  useAiAckLog(v.sysid, camera?.state.ai_ack, dict)
  return (
    <section className="float top1 cockpit">
      <div className="vtile" style={{ cursor: 'default' }}>
        {live ? (
          <video ref={ref} className="feed" muted autoPlay playsInline />
        ) : (
          <div className="t3 vtile-off">
            <div>
              <IconVideoOff />
              <div>{dict.videoNotConnected}</div>
            </div>
          </div>
        )}
        {has && <VideoOverlay state={camera.state} rect={rect} thermalOverlay={profile?.thermal_overlay ?? true} preview={preview} dict={dict} layerRef={layerRef} clickable={isClickable(camera)} onClick={onClick} />}
        <div className="cockpit-pills">
          <div className="g-ctl row" style={{ gap: 12, padding: '8px 14px', borderRadius: 999 }}>
            <KindIcon kind={v.kind} />
            <span style={{ fontSize: 19, fontWeight: 500 }}>{v.name}</span>
            {v.warn && <IconWarn size={20} />}
            <ModeBadge v={v} dict={dict} />
          </div>
          <div className="g-ctl row num" style={{ gap: 18, fontSize: 14, padding: '6px 14px', borderRadius: 999, color: 'var(--text-2)' }}>
            <StatLine v={v} />
          </div>
          {recording === 'recording' && (
            <span className="pill pill-rec">
              <span className="rdot" /> AUTO REC <span className="num">{recDuration(0, elapsedMs)}</span>
            </span>
          )}
        </div>
        {has && (
          <div className="g-ctl row num cockpit-source" title={dict.videoLatency.replace('{cam}', source)}>
            <span>{source}</span>
            <span className="cockpit-sep" />
            <span>{delay}</span>
          </div>
        )}
        <button type="button" className="g-ctl btn-icon lg cockpit-restore" aria-label={dict.restore} title={dict.restore} onClick={onRestore}>
          <IconMinimize size={18} />
        </button>
        {has && <CamBar caps={camera.caps} state={camera.state} pending={pending} dict={dict} onCommand={onCommand} onSettings={onSettings} roi={roi} />}
      </div>
      <div className="cockpit-side">
        <div className="surface cockpit-map">{map}</div>
        {has && <CamCard caps={camera.caps} state={camera.state} videoText={[encodingLabel(camera.state.encoding), source, delay].filter(Boolean).join('  ')} dict={dict} roiText={activeId === null ? null : roiText(active?.name ?? activeId, roiStatus, dict)} />}
      </div>
    </section>
  )
}
