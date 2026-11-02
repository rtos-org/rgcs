import type { MouseEvent, Ref } from 'react'
import type { CameraState, TrackState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { detectionToDisplay, knownStream, pointToDisplay, rectToDisplay, type Rect } from './geometry'

interface Props {
  readonly state: CameraState
  /** The picture's cover rect inside the overlay (null while sizes are unknown). */
  readonly rect: Rect | null
  /** The profile's `thermal_overlay` (IR markers on / off). */
  readonly thermalOverlay: boolean
  /** The box a click just asked for, shown until the first 0x50 arrives. */
  readonly preview: Rect | null
  readonly dict: Dict
  /** The layer is the click target and the element the cockpit measures. */
  readonly layerRef?: Ref<HTMLDivElement>
  /** Crosshair cursor while a click would do something. */
  readonly clickable?: boolean
  readonly onClick?: (e: MouseEvent<HTMLDivElement>) => void
}

/** No browser menu over the video; on macOS Ctrl+click arrives only as a context menu event, so it counts as the click. */
function onContextMenu(e: MouseEvent<HTMLDivElement>, onClick: ((e: MouseEvent<HTMLDivElement>) => void) | undefined): void {
  e.preventDefault()
  if (e.ctrlKey) onClick?.(e)
}

const box = (r: Rect) => ({ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` })
const temp = (c: number) => `${c.toFixed(1)}℃`

function TrackBox({ track, rect, dict }: { readonly track: TrackState; readonly rect: Rect; readonly dict: Dict }) {
  const tracking = track.status === 'tracking'
  return (
    <div className={`trk ${tracking ? 'tracking' : 'lost'}`} style={box(rectToDisplay(track.rect, rect))}>
      <span className="tag">{tracking ? dict.trackTracking : dict.trackLost}</span>
    </div>
  )
}

function Marker({ cls, at, text }: { readonly cls: string; readonly at: { x: number; y: number }; readonly text: string }) {
  return (
    <div className={cls} style={{ left: `${at.x}px`, top: `${at.y}px` }}>
      <i />
      <span>{text}</span>
    </div>
  )
}

/** IR max / min (0x14) and the Alt+click point (0x12), in main-stream pixels. */
function ThermalMarks({ state, rect }: { readonly state: CameraState; readonly rect: Rect }) {
  const stream = knownStream(state.stream)
  const th = state.thermal
  if (!stream || !th) return null
  const at = (xy: readonly [number, number]) => pointToDisplay(xy, stream, rect)
  return (
    <>
      {th.frame && <Marker cls="tmark hot" at={at(th.frame.max_xy)} text={temp(th.frame.max_c)} />}
      {th.frame && <Marker cls="tmark cold" at={at(th.frame.min_xy)} text={temp(th.frame.min_c)} />}
      {th.point && <Marker cls="tmark" at={at(th.point.xy)} text={temp(th.point.temp_c)} />}
    </>
  )
}

/** Prototype 757–762: track box, detections (RGB), temperature markers (IR with the overlay on). */
export function VideoOverlay({ state, rect, thermalOverlay, preview, dict, layerRef, clickable = false, onClick }: Props) {
  const mode = state.video_mode ?? 'rgb'
  return (
    <div ref={layerRef} className={`cockpit-overlay${clickable ? ' clickable' : ''}`} onClick={onClick} onContextMenu={(e) => onContextMenu(e, onClick)}>
      {rect && mode === 'rgb' && state.candidates.map((d, i) => <div key={i} className="cand" style={box(detectionToDisplay(d, rect))} />)}
      {rect && state.track && <TrackBox track={state.track} rect={rect} dict={dict} />}
      {!state.track && preview && <div className="trk" style={box(preview)} />}
      {rect && mode === 'thermal' && thermalOverlay && <ThermalMarks state={state} rect={rect} />}
    </div>
  )
}
