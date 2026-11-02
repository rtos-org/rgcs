import type { MissionStats, VehicleKind } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { durText, km } from './labels'

/** The map's summary pill: distance, time and (not for a rover) the maximum altitude. */
export function MissionHud({ stats, kind, dict }: { readonly stats: MissionStats; readonly kind: VehicleKind | null; readonly dict: Dict }) {
  return (
    <div className="g-ctl float map-c num mission-pill" aria-hidden="true">
      <span>
        <span className="t3">{dict.mDistance}</span>
        {km(stats.distance_m)}
      </span>
      <span>
        <span className="t3">{dict.mEstTime}</span>
        {durText(stats.duration_s, dict)}
      </span>
      {kind !== 'rover' && (
        <span>
          <span className="t3">{dict.mMaxAlt}</span>
          {`${Math.round(stats.max_alt)} m`}
        </span>
      )}
    </div>
  )
}
