import type { CameraCaps, CameraCommand, CameraState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconCamera, IconGear, IconMinus, IconPlus } from '../../shared/ui/icons'
import { zoomText } from './format'

interface Props {
  readonly caps: CameraCaps
  readonly state: CameraState
  readonly pending: boolean
  readonly onCommand: (cmd: CameraCommand) => void
  readonly onSettings: () => void
  readonly dict: Dict
}

/** The camera strip (prototype `.cam-strip`): record, photo, zoom stepper, gear — one row (the video type sits on the thumbnail). */
export function CameraStrip({ caps, state, pending, onCommand, onSettings, dict }: Props) {
  if (caps.kind === 'none') return null
  const recording = state.recording === 'recording'
  return (
    <div className="cam-strip">
      {caps.record && (
        <button
          type="button"
          className={`rec-btn${recording ? ' on' : ''}`}
          aria-label={dict.record}
          title={dict.record}
          aria-pressed={recording}
          disabled={pending}
          onClick={() => onCommand({ cmd: recording ? 'record_stop' : 'record_start' })}
        >
          <span className="rdot" />
        </button>
      )}
      {caps.photo && (
        <button type="button" className="rec-btn" aria-label={dict.photo} title={dict.photo} onClick={() => onCommand({ cmd: 'photo' })}>
          <IconCamera />
        </button>
      )}
      {caps.zoom?.step && (
        <div className="zstep">
          <button type="button" className="btn-icon sm" aria-label={dict.zoomOut} title={dict.zoomOut} onClick={() => onCommand({ cmd: 'zoom_step', args: { steps: -1 } })}>
            <IconMinus />
          </button>
          <span className="big num">{zoomText(state.zoom, caps.zoom.unit)}</span>
          <button type="button" className="btn-icon sm" aria-label={dict.zoomIn} title={dict.zoomIn} onClick={() => onCommand({ cmd: 'zoom_step', args: { steps: 1 } })}>
            <IconPlus />
          </button>
        </div>
      )}
      <div className="grow" />
      <button type="button" className="btn-icon" aria-label={dict.cameraSettings} title={dict.cameraSettings} onClick={onSettings}>
        <IconGear size={18} />
      </button>
    </div>
  )
}
