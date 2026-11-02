import type { MouseEvent } from 'react'
import { KindIcon } from '../../shared/ui/KindIcon'
import type { RecordingState, VehicleState, VideoSourceStatus } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconMaximize, IconVideoOff, IconWarn } from '../../shared/ui/icons'
import { isLive, recDuration, useRecElapsed, useWhepFeed } from '../camera'
import { StatLine } from './StatLine'
import { ModeBadge } from '../vehicles/ModeBadge'

interface Props {
  readonly vehicles: readonly VehicleState[]
  readonly videoSources: ReadonlyMap<number, VideoSourceStatus>
  readonly recording: ReadonlyMap<number, RecordingState>
  readonly selected: number | null
  readonly dict: Dict
  readonly onSelect: (sysid: number) => void
  readonly onMaximize: (sysid: number) => void
}

/** The video grid (prototype `isVideoGrid`): every vehicle's feed, auto-wrapping at 360 px. */
export function VideoGrid({ vehicles, videoSources, recording, selected, dict, onSelect, onMaximize }: Props) {
  return (
    <section className="float top1 video-grid">
      {vehicles.map((v) => (
        <VideoTile key={v.sysid} vehicle={v} status={videoSources.get(v.sysid)} recording={recording.get(v.sysid) ?? 'idle'} selected={v.sysid === selected} dict={dict} onSelect={onSelect} onMaximize={onMaximize} />
      ))}
    </section>
  )
}

interface TileProps {
  readonly vehicle: VehicleState
  readonly status: VideoSourceStatus | undefined
  readonly recording: RecordingState
  readonly selected: boolean
  readonly dict: Dict
  readonly onSelect: (sysid: number) => void
  readonly onMaximize: (sysid: number) => void
}

function VideoTile({ vehicle: v, status, recording, selected, dict, onSelect, onMaximize }: TileProps) {
  const live = isLive(status)
  const { ref } = useWhepFeed(v.sysid, live)
  const elapsedMs = useRecElapsed(recording)
  const maximize = (e: MouseEvent) => {
    e.stopPropagation()
    onMaximize(v.sysid)
  }
  return (
    <div data-testid="vtile" className={`vtile${selected ? ' sel' : ''}`} onClick={() => onSelect(v.sysid)}>
      {live && <video ref={ref} className="feed" muted autoPlay playsInline />}
      {!live && (
        <div className="t3 vtile-off">
          <div>
            <IconVideoOff />
            <div>{dict.videoNotConnected}</div>
          </div>
        </div>
      )}
      <div className="vtile-shade" />
      <div className="vtile-head">
        <div className="row" style={{ gap: 10 }}>
          <KindIcon kind={v.kind} />
          <span style={{ fontSize: 17, fontWeight: 500 }}>{v.name}</span>
          <ModeBadge v={v} dict={dict} />
          {v.warn && <IconWarn size={20} />}
          <div className="grow" />
          {recording === 'recording' && (
            <span className="pill pill-rec" style={{ height: 28 }}>
              <span className="rdot" /> AUTO REC <span className="num">{recDuration(0, elapsedMs)}</span>
            </span>
          )}
          <button type="button" className="g-ctl btn-icon" aria-label={dict.maximize} title={dict.maximize} onClick={maximize} style={{ width: 34, height: 34, color: '#fff' }}>
            <IconMaximize />
          </button>
        </div>
        {/* the cockpit's glass pill: readable over bright video */}
        <div className="g-ctl row num vtile-stat">
          <StatLine v={v} />
        </div>
      </div>
    </div>
  )
}
