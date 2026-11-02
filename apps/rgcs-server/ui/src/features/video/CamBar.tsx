import { useState } from 'react'
import type { CameraCaps, CameraCommand, CameraState, GimbalMode, RoiTarget, VideoMode, ZoomCaps } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconCamera, IconCrosshair, IconGear, IconMinus, IconPlus } from '../../shared/ui/icons'
import { zoomText } from '../camera'
import { RoiChips } from '../roi/RoiChips'
import { isSet } from '../roi/schema'
import { AI_CENTRE_BOX_PX, ZOOM_SLIDER_MAX, posToZoom, zoomToPos } from './cockpitView'

interface Props {
  readonly caps: CameraCaps
  readonly state: CameraState
  readonly pending: boolean
  readonly dict: Dict
  readonly onCommand: (cmd: CameraCommand) => void
  readonly onSettings: () => void
  /** GPS ROI chips under the bar: the vehicle's presets and the active one. */
  readonly roi?: RoiChipsProps
}

export interface RoiChipsProps {
  readonly targets: readonly RoiTarget[]
  readonly activeId: string | null
  readonly onStart: (id: string) => void
  readonly onStop: () => void
}

const GIMBAL_LABEL: Record<GimbalMode, keyof Dict> = { lock: 'gimbalLock', follow: 'gimbalFollow', fpv: 'gimbalFpv' }

/** Prototype `.cam-bar .bar`: everything is gated by the camera's caps. */
export function CamBar({ caps, state, pending, dict, onCommand, onSettings, roi }: Props) {
  const recording = state.recording === 'recording'
  const modeLabel: Record<VideoMode, string> = { rgb: 'RGB', thermal: 'IR', side_by_side: dict.sbs }
  const showRoi = roi !== undefined && caps.roi !== 'none' && roi.targets.some(isSet)
  return (
    <div className="cam-bar">
      <div className="g-ctl bar">
        {caps.record && (
          <button type="button" className={`rec-btn${recording ? ' on' : ''}`} aria-label={dict.record} title={dict.record} aria-pressed={recording} disabled={pending} onClick={() => onCommand({ cmd: recording ? 'record_stop' : 'record_start' })}>
            <span className="rdot" />
          </button>
        )}
        {caps.photo && (
          <button type="button" className="rec-btn" aria-label={dict.photo} title={dict.photo} onClick={() => onCommand({ cmd: 'photo' })}>
            <IconCamera />
          </button>
        )}
        {caps.zoom && <ZoomControl caps={caps.zoom} zoom={state.zoom} dict={dict} onCommand={onCommand} />}
        {caps.video_modes.length > 1 && (
          <Seg label={dict.videoType} width={172} items={caps.video_modes.map((m) => ({ key: m, label: modeLabel[m], on: (state.video_mode ?? 'rgb') === m, pick: () => onCommand({ cmd: 'video_mode', args: { mode: m } }) }))} />
        )}
        {caps.gimbal && caps.gimbal.modes.length > 0 && (
          <Seg label={dict.gimbalMode} width={196} items={caps.gimbal.modes.map((m) => ({ key: m, label: dict[GIMBAL_LABEL[m]], on: state.gimbal_mode === m, pick: () => onCommand({ cmd: 'gimbal_mode', args: { mode: m } }) }))} />
        )}
        {caps.gimbal?.center && (
          <button type="button" className="btn-icon" aria-label={dict.centerGimbal} title={dict.centerGimbal} onClick={() => onCommand({ cmd: 'gimbal_center', args: { mode: 'one_key_reset' } })}>
            <IconCrosshair size={20} />
          </button>
        )}
        {caps.ai_tracking && <AiTrackButton state={state} dict={dict} onCommand={onCommand} />}
        <button type="button" className="btn-icon" aria-label={dict.cameraSettings} title={dict.cameraSettings} onClick={onSettings}>
          <IconGear size={18} />
        </button>
      </div>
      {showRoi && <RoiChips {...roi} dict={dict} />}
    </div>
  )
}

/** Prototype 785: AI追跡 toggles a centre box (200 px, like the joystick) / cancel; RGB only. */
function AiTrackButton({ state, dict, onCommand }: { readonly state: CameraState; readonly dict: Dict; readonly onCommand: (cmd: CameraCommand) => void }) {
  const tracking = state.track !== null
  const rgb = (state.video_mode ?? 'rgb') === 'rgb'
  const toggle = () => onCommand(tracking ? { cmd: 'ai_cancel' } : { cmd: 'ai_select_box', args: { x: 0.5, y: 0.5, box_px: AI_CENTRE_BOX_PX } })
  return (
    <button type="button" className={`btn btn-sm${tracking ? ' on' : ''}`} aria-pressed={tracking} disabled={!rgb} title={rgb ? undefined : dict.camErr_rgb_only} onClick={toggle}>
      {dict.aiTrack}
    </button>
  )
}

interface SegItem {
  readonly key: string
  readonly label: string
  readonly on: boolean
  readonly pick: () => void
}

function Seg({ label, width, items }: { readonly label: string; readonly width: number; readonly items: readonly SegItem[] }) {
  const current = Math.max(0, items.findIndex((i) => i.on))
  return (
    <div className={`seg n${items.length}`} role="group" aria-label={label} style={{ width }}>
      <span className="lens" style={{ transform: `translateX(${current * 100}%)` }} />
      {items.map((i) => (
        <button key={i.key} type="button" className={i.on ? 'on' : ''} onClick={i.pick}>
          {i.label}
        </button>
      ))}
    </div>
  )
}

interface ZoomProps {
  readonly caps: ZoomCaps
  readonly zoom: number
  readonly dict: Dict
  readonly onCommand: (cmd: CameraCommand) => void
}

/** − / slider (log for ×, linear for %) / + / value. The slider sends one `zoom_absolute` when released, not one per pixel. */
function ZoomControl({ caps, zoom, dict, onCommand }: ZoomProps) {
  const { max, absolute, step, unit } = caps
  const [dragPos, setDragPos] = useState<number | null>(null)
  const commit = () => {
    if (dragPos === null) return
    onCommand({ cmd: 'zoom_absolute', args: { zoom: posToZoom(dragPos, max, unit) } })
    setDragPos(null)
  }
  const shown = dragPos === null ? zoom : posToZoom(dragPos, max, unit)
  return (
    <div className="zoom">
      {step && (
        <button type="button" className="btn-icon sm" aria-label={dict.zoomOut} title={dict.zoomOut} onClick={() => onCommand({ cmd: 'zoom_step', args: { steps: -1 } })}>
          <IconMinus />
        </button>
      )}
      {absolute && (
        <input type="range" min={0} max={ZOOM_SLIDER_MAX} aria-label={dict.zoom} title={dict.zoom} value={dragPos ?? zoomToPos(zoom, max, unit)} onChange={(e) => setDragPos(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      )}
      {step && (
        <button type="button" className="btn-icon sm" aria-label={dict.zoomIn} title={dict.zoomIn} onClick={() => onCommand({ cmd: 'zoom_step', args: { steps: 1 } })}>
          <IconPlus />
        </button>
      )}
      <span className="val">{zoomText(shown, unit)}</span>
    </div>
  )
}
