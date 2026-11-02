import type { CameraCaps, CameraState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { clockDanger, clockText, sdDanger, sdText, thermalText } from '../camera/mediaFormat'
import { dialOffset, gimbalText } from './cockpitView'

interface Props {
  readonly caps: CameraCaps
  readonly state: CameraState
  readonly videoText: string
  readonly dict: Dict
  /** The active ROI line ("送電塔 A  方位 123°  412 m"); null when ROI is off. */
  readonly roiText?: string | null
}

/** Prototype `.cam-card`: gimbal dial + rows; rows the camera cannot report are left out. */
export function CamCard({ caps, state, videoText, dict, roiText = null }: Props) {
  const att = caps.gimbal?.attitude && state.gimbal ? state.gimbal : null
  const dial = dialOffset(att)
  const thermal = caps.thermal ? thermalText(state.thermal) : null
  const danger = (on: boolean) => (on ? { color: 'var(--danger)' } : undefined)
  return (
    <div className="surface cam-card">
      {att && (
        <div className="cam-dial" title={dict.gimbal}>
          <span className="nose" />
          <span className="pt" style={{ transform: `translate(${dial.x}px, ${dial.y}px)` }} />
        </div>
      )}
      <div className="kv grow">
        {att && (
          <>
            <span>{dict.gimbal}</span>
            <span>{gimbalText(state.gimbal_mode, att)}</span>
          </>
        )}
        {roiText && (
          <>
            <span>ROI</span>
            <span>{roiText}</span>
          </>
        )}
        {thermal && (
          <>
            <span>{dict.thermal}</span>
            <span>{thermal}</span>
          </>
        )}
        {caps.storage_info && (
          <>
            <span>{dict.camSd}</span>
            <span style={danger(sdDanger(state.storage))}>{sdText(state.storage, dict) ?? dict.unknown}</span>
          </>
        )}
        {caps.clock_sync && (
          <>
            <span>{dict.camClock}</span>
            <span style={danger(clockDanger(state.clock))}>{clockText(state.clock, dict)}</span>
          </>
        )}
        <span>{dict.videoRow}</span>
        <span>{videoText}</span>
      </div>
    </div>
  )
}
