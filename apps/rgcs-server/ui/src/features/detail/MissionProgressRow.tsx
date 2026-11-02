import type { Mission, MissionProgress, MissionTransfer, VehicleState } from '../../shared/api/types'
import { TransferBar } from '../mission/TransferBar'
import type { Dict } from '../../shared/i18n'
import { remainingDistanceM } from '../mission/geo'
import { IconUpload } from '../../shared/ui/icons'

interface Props {
  readonly progress: MissionProgress | null
  readonly mission: Mission | null
  readonly vehicle: VehicleState
  readonly dict: Dict
  readonly onWrite: () => void
  /** `restart`: the mission had finished; it runs again from WP 1. */
  readonly onStart: (restart: boolean) => void
  /** A mission write in progress for this vehicle. */
  readonly transfer?: MissionTransfer | null
}

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`)

function progressText(progress: MissionProgress | null, mission: Mission | null, total: number | null, dict: Dict): string {
  if (progress) return `WP ${progress.seq} / ${total ?? '—'}`
  return mission ? `${mission.items.length} ${dict.mItems}` : '—'
}

/** Addendum §5.7: current WP / remaining distance plus the 書込… / 開始 shortcuts. */
export function MissionProgressRow({ progress, mission, vehicle, dict, onWrite, onStart, transfer = null }: Props) {
  const total = mission?.items.length ?? progress?.total ?? null
  const remaining = mission && progress ? remainingDistanceM(mission.items, progress.seq, vehicle.lat === 0 && vehicle.lon === 0 ? null : vehicle) : null
  const done = progress !== null && total !== null && total > 0 && progress.seq >= total
  return (
    <>
      <div className="mission-progress" data-testid="mission-progress">
        <span className="t3 nowrap">{dict.planMission}</span>
        <span className="num nowrap" title={progress && total === null ? dict.mTotalUnknown : undefined}>
          {progressText(progress, mission, total, dict)}
          {remaining !== null && ` · ${dict.mRemaining} ${km(remaining)}`}
        </span>
        <span className="mp-btns">
          <button type="button" className="btn btn-sm nowrap" onClick={onWrite}>
            <IconUpload size={14} />
            {dict.mWriteShort}
          </button>
          {mission && (
            <button type="button" className="btn btn-primary btn-sm nowrap" onClick={() => onStart(done)}>
              {done ? dict.mRestart : dict.mStart}
            </button>
          )}
        </span>
      </div>
      {(transfer?.phase === 'write' || transfer?.phase === 'verify') && (
        <div style={{ padding: '0 12px 8px' }}>
          <TransferBar transfer={transfer} dict={dict} />
        </div>
      )}
    </>
  )
}
