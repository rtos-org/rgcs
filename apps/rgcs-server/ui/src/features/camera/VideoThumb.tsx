import type { RecordingState, VideoMode, VideoSourceStatus } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { recDuration } from './format'
import { isLive, useRecElapsed, useWhepFeed } from './useWhepFeed'
import { IconMaximize } from '../../shared/ui/icons'

interface Props {
  readonly sysid: number
  readonly status: VideoSourceStatus | undefined
  readonly recording: RecordingState
  readonly dict: Dict
  /** The camera's video types; the RGB / IR / 2画面 segment shows when there is more than one. */
  readonly modes?: readonly VideoMode[]
  readonly mode?: VideoMode | null
  readonly onMode?: (mode: VideoMode) => void
  /** Opens the camera cockpit; the button is disabled without it. */
  readonly onMaximize?: () => void
}

const MODE_LABEL: Record<VideoMode, string> = { rgb: 'RGB', thermal: 'IR', side_by_side: '2画面' }

/** Prototype `.seg.n3.sm.onmap` at the thumbnail's bottom left. */
function VideoTypeSeg({ modes, mode, onMode, label }: { readonly modes: readonly VideoMode[]; readonly mode: VideoMode | null; readonly onMode: (m: VideoMode) => void; readonly label: string }) {
  const current = Math.max(0, modes.indexOf(mode ?? 'rgb'))
  return (
    <div className={`seg n${Math.min(modes.length, 4)} sm onmap`} role="group" aria-label={label} style={{ position: 'absolute', left: 10, bottom: 10, width: 168 }}>
      <span className="lens" style={{ transform: `translateX(${current * 100}%)` }} />
      {modes.map((m) => (
        <button key={m} type="button" className={mode === m ? 'on' : ''} onClick={() => onMode(m)}>
          {MODE_LABEL[m]}
        </button>
      ))}
    </div>
  )
}

/** 16:9 thumbnail in the detail panel, fed by WHEP when a source is live. */
export function VideoThumb({ sysid, status, recording, dict, modes = [], mode = null, onMode, onMaximize }: Props) {
  const live = isLive(status)
  const { ref: videoRef, phase } = useWhepFeed(sysid, live)
  const elapsedMs = useRecElapsed(recording)

  return (
    <div className="detail-video">
      {live ? <video ref={videoRef} className="feed" muted autoPlay playsInline /> : <span className="t3">{dict.videoNotConnected}</span>}
      {recording === 'recording' && (
        <span className="pill pill-rec detail-rec">
          <span className="rdot" /> AUTO REC <span className="num">{recDuration(0, elapsedMs)}</span>
        </span>
      )}
      {live && phase === 'reconnecting' && <span className="hint caution detail-reconnect">{dict.reconnecting}</span>}
      {modes.length > 1 && onMode && <VideoTypeSeg modes={modes} mode={mode} onMode={onMode} label={dict.videoType} />}
      <button type="button" className="g-ctl btn-icon maximize" aria-label={dict.maximize} title={dict.maximize} disabled={!onMaximize} onClick={onMaximize}>
        <IconMaximize />
      </button>
    </div>
  )
}
