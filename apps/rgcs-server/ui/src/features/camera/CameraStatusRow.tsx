import type { CameraCaps, CameraState, GimbalMode } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { angleText } from './format'
import { trackLabel } from './mediaFormat'
import { IconPan, IconTilt } from '../../shared/ui/icons'

interface Props {
  readonly caps: CameraCaps
  readonly state: CameraState
  readonly onSetup: () => void
  readonly dict: Dict
  /** The active GPS ROI preset's name; absent when ROI is off. */
  readonly roiName?: string | null
}

const MODE: Record<GimbalMode, keyof Dict> = { lock: 'gimbalLock', follow: 'gimbalFollow', fpv: 'gimbalFpv' }

/** A MAVLink camera has no gimbal mode: its name takes the cell (「MAVLink カメラ | 角度」). */
function modeText(caps: CameraCaps, state: CameraState, dict: Dict): string {
  if (caps.kind === 'mavlink') return dict.mavlinkCamera
  return state.gimbal_mode ? dict[MODE[state.gimbal_mode]] : '—'
}

/** "ロック | pan yaw, tilt pitch" (Lucide icons), or the setup prompt when no camera. */
export function CameraStatusRow({ caps, state, onSetup, dict, roiName }: Props) {
  if (caps.kind === 'none') {
    return (
      <div className="cam-status" data-testid="cam-status">
        <span>{dict.cameraNotConfigured}</span>
        <span className="sep" />
        <button type="button" className="btn btn-sm btn-ghost" onClick={onSetup}>
          {dict.setUp}
        </button>
      </div>
    )
  }
  const track = trackLabel(state.track, dict)
  return (
    <div className="cam-status" data-testid="cam-status">
      {!state.connected && <span className="danger">{dict.disconnected}</span>}
      {state.connected && <span>{modeText(caps, state, dict)}</span>}
      {caps.gimbal?.attitude && state.gimbal && (
        <>
          <span className="sep" />
          <span className="num row cam-angle" title={dict.gimbalPan}>
            <IconPan />
            {angleText(state.gimbal.yaw)}
          </span>
          <span className="num row cam-angle" title={dict.gimbalTilt}>
            <IconTilt />
            {angleText(state.gimbal.pitch)}
          </span>
        </>
      )}
      {roiName && (
        <>
          <span className="sep" />
          <span>ROI {roiName}</span>
        </>
      )}
      {track && (
        <>
          <span className="sep" />
          <span className={state.track?.status === 'tracking' ? undefined : 'caution'}>{track}</span>
        </>
      )}
    </div>
  )
}
