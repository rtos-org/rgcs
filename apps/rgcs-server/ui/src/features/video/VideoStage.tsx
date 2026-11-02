import { useMemo, type ReactNode } from 'react'
import type { CameraCommand, CameraSnapshot, RecordingState, RoiStatus, VehicleState, VideoSourceStatus } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { useRoiTargets } from '../roi/targetsStore'
import { Cockpit } from './Cockpit'
import { VideoGrid } from './VideoGrid'

interface Props {
  readonly vehicles: readonly VehicleState[]
  readonly cameras: ReadonlyMap<number, CameraSnapshot>
  readonly videoSources: ReadonlyMap<number, VideoSourceStatus>
  /** Vehicles with a camera command in flight. */
  readonly pending: ReadonlySet<number>
  readonly selected: number | null
  /** The vehicle shown in the cockpit; null (or a vehicle that is gone) shows the grid. */
  readonly maximized: number | null
  readonly dict: Dict
  readonly onSelect: (sysid: number) => void
  readonly onMaximize: (sysid: number) => void
  readonly onRestore: () => void
  readonly onCommand: (sysid: number, cmd: CameraCommand) => void
  readonly onSettings: (sysid: number) => void
  /** The cockpit's mini map (the operations map's layers, centred on the vehicle). */
  readonly miniMap: ReactNode
  /** Live GPS ROI status per vehicle and the cockpit chip actions. */
  readonly roi?: ReadonlyMap<number, RoiStatus>
  readonly onRoiStart?: (sysid: number, id: string) => void
  readonly onRoiStop?: (sysid: number) => void
}

/** 全機体映像: the grid of every feed, or one vehicle's camera cockpit. */
export function VideoStage(p: Props) {
  const recording = useMemo(() => new Map<number, RecordingState>([...p.cameras].map(([sysid, c]) => [sysid, c.state.recording])), [p.cameras])
  const max = p.maximized === null ? undefined : p.vehicles.find((v) => v.sysid === p.maximized)
  const roiTargets = useRoiTargets(max?.sysid ?? null)
  const { onRoiStart, onRoiStop } = p
  return (
    <>
      <div className="aurora video-backdrop" />
      {max ? (
        <Cockpit
          vehicle={max}
          camera={p.cameras.get(max.sysid)}
          status={p.videoSources.get(max.sysid)}
          pending={p.pending.has(max.sysid)}
          dict={p.dict}
          onCommand={(cmd) => p.onCommand(max.sysid, cmd)}
          onSettings={() => p.onSettings(max.sysid)}
          onRestore={p.onRestore}
          map={p.miniMap}
          roiTargets={roiTargets}
          roiStatus={p.roi?.get(max.sysid)}
          onRoiStart={onRoiStart && ((id) => onRoiStart(max.sysid, id))}
          onRoiStop={onRoiStop && (() => onRoiStop(max.sysid))}
        />
      ) : (
        <VideoGrid vehicles={p.vehicles} videoSources={p.videoSources} recording={recording} selected={p.selected} dict={p.dict} onSelect={p.onSelect} onMaximize={p.onMaximize} />
      )}
    </>
  )
}
