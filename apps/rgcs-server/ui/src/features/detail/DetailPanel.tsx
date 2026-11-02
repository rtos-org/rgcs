import type { CameraCommand, CameraSnapshot, Mission, MissionProgress, MissionTransfer, LogEntry, SysId, VehicleCommand, VehicleState, VideoSourceStatus } from '../../shared/api/types'
import type { BtnState } from '../commands'
import { CameraStatusRow, CameraStrip, VideoThumb } from '../camera'
import type { Dict } from '../../shared/i18n'
import { IconClose, IconPin } from '../../shared/ui/icons'
import { battText, dotClass, homeDistText, modeLabel } from '../vehicles/format'
import { BattBar } from '../vehicles/BattBar'
import { ArmChip } from '../vehicles/ArmChip'
import { DetailMessages } from './DetailMessages'
import { EmergencyRow } from './EmergencyRow'
import { DetailTiles } from './DetailTiles'
import { InstrumentsRow } from './InstrumentsRow'
import { MissionProgressRow } from './MissionProgressRow'

interface Props {
  readonly vehicle: VehicleState
  /** The message log (newest first); the panel shows this vehicle's newest one. */
  readonly entries: readonly LogEntry[]
  readonly onAck: (sysid: SysId, id: number) => void
  /** Opens メッセージ履歴 filtered to the vehicle. */
  readonly onOpenLog: (sysid: SysId) => void
  readonly onClose: () => void
  readonly onOpenCommands: () => void
  readonly dict: Dict
  readonly camera?: CameraSnapshot
  readonly videoSource?: VideoSourceStatus
  readonly cameraPending?: boolean
  readonly onCameraCommand?: (cmd: CameraCommand) => void
  readonly onCameraSettings?: () => void
  /** The active GPS ROI preset's name for the camera status row. */
  readonly roiName?: string | null
  /** Opens this vehicle's camera cockpit (全機体映像). */
  readonly onMaximize?: (sysid: SysId) => void
  readonly vehicleMission?: Mission
  readonly missionProgress?: MissionProgress
  readonly missionTransfer?: MissionTransfer
  readonly onWriteMission?: () => void
  readonly onStartMission?: (restart: boolean) => void
  readonly commandsOpen?: boolean
  /** Emergency buttons (pause / RTL / land) send through the shared command runner. */
  readonly onCommand?: (command: VehicleCommand) => void
  readonly feedback?: (cmd: string) => BtnState | null
  /** Opens メンテナンス・設定 on this vehicle. */
  readonly onOpenMaint?: (sysid: SysId) => void
  /** A calibration of this vehicle failed or is older than 30 days. */
  readonly maintAttention?: boolean
  /** The panel stays on this vehicle while the selection moves. */
  readonly pinned?: boolean
  readonly onTogglePin?: (sysid: SysId) => void
}

const NONE_CAPS: CameraSnapshot['caps'] = { kind: 'none', gimbal: null, zoom: null, focus: false, photo: false, record: false, video_modes: [], hfov_deg: null, roi: 'none', thermal: null, ai_tracking: null, encoding_presets: [], storage_info: false, clock_sync: false }
const OFFLINE: CameraSnapshot['state'] = {
  connected: false, last_error: null, firmware: null, recording: 'idle', zoom: 1, zoom_max: 1, video_mode: null, gimbal: null, gimbal_mode: null, stream: null, encoding: null, thermal: null, track: null, candidates: [], ai_ack: null, storage: null, clock: null,
}

/** Right panel, 372 px, markup after the Glass prototype's right panel. */
export function DetailPanel(p: Props) {
  const { vehicle: v, onClose, onOpenCommands, dict, camera, videoSource, cameraPending = false, onCameraCommand, onCameraSettings } = p
  const caps = camera?.caps ?? NONE_CAPS
  const camState = camera?.state ?? OFFLINE
  return (
    <aside className="g panel float float-r detail" aria-label={v.name}>
      <div className="panel-h">
        <span className={dotClass(v)} style={{ width: 11, height: 11 }} />
        <span className="h1">{v.name}</span>
        <span className="row detail-state" data-testid="detail-state">
          <span className="badge">{modeLabel(v, dict)}</span>
          <ArmChip armed={v.armed} dict={dict} />
        </span>
        <div className="grow" />
        <button
          type="button"
          className={`btn-icon${p.pinned ? ' on' : ''}`}
          title={p.pinned ? dict.unpinVehicle : dict.pinVehicle}
          aria-label={p.pinned ? dict.unpinVehicle : dict.pinVehicle}
          aria-pressed={p.pinned === true}
          disabled={!p.onTogglePin}
          onClick={() => p.onTogglePin?.(v.sysid)}
        >
          <IconPin />
        </button>
        <button type="button" className="btn-icon" aria-label={dict.close} title={dict.close} onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="detail-body">
        <VideoThumb
          sysid={v.sysid}
          status={videoSource}
          recording={camState.recording}
          dict={dict}
          modes={caps.video_modes}
          mode={camState.video_mode}
          onMode={(mode) => onCameraCommand?.({ cmd: 'video_mode', args: { mode } })}
          {...(p.onMaximize ? { onMaximize: () => p.onMaximize?.(v.sysid) } : {})}
        />
        <CameraStrip caps={caps} state={camState} pending={cameraPending} onCommand={(c) => onCameraCommand?.(c)} onSettings={() => onCameraSettings?.()} dict={dict} />
        <CameraStatusRow caps={caps} state={camState} onSetup={() => onCameraSettings?.()} dict={dict} roiName={p.roiName ?? null} />
        <div className="detail-telemetry num">
          {v.kind === 'rover' ? (
            <span className="kv">
              <span className="big" data-testid="dist">
                {homeDistText(v)}
              </span>
              <span className="lbl">{dict.fromHome}</span>
            </span>
          ) : (
            <span className="kv">
              <span className="big" data-testid="alt">
                {Math.round(v.alt_rel)} m
              </span>
              <span className="lbl">{dict.altitude}</span>
            </span>
          )}
          <span className="kv">
            <span className="big" data-testid="speed">
              {v.ground_speed.toFixed(1)} m/s
            </span>
            <span className="lbl">{dict.speed}</span>
          </span>
          <span className="kv">
            <span className="big" data-testid="batt">
              {battText(v)}
            </span>
            <span className="row" style={{ gap: 6 }}>
              <BattBar v={v} dict={dict} />
              <span className="lbl">{dict.battery}</span>
            </span>
          </span>
        </div>
        {p.onCommand && <EmergencyRow vehicle={v} dict={dict} onCommand={p.onCommand} feedback={p.feedback} />}
        {p.onWriteMission && (
          <MissionProgressRow progress={p.missionProgress ?? null} mission={p.vehicleMission ?? null} vehicle={v} dict={dict} onWrite={p.onWriteMission} onStart={(restart) => p.onStartMission?.(restart)} transfer={p.missionTransfer ?? null} />
        )}
        <DetailTiles
          sysid={v.sysid}
          maintAttention={p.maintAttention === true}
          commandsOpen={p.commandsOpen === true}
          dict={dict}
          onOpenMaint={p.onOpenMaint}
          onOpenLog={p.onOpenLog}
          onOpenCommands={onOpenCommands}
        />
        <InstrumentsRow vehicle={v} dict={dict} />
        <DetailMessages sysid={v.sysid} entries={p.entries} dict={dict} onAck={p.onAck} onOpenLog={p.onOpenLog} />
      </div>
    </aside>
  )
}
