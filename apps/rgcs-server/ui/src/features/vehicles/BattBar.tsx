import type { VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { battLow, battWidth } from './format'

/** The battery glyph: filled to the percentage; empty and dashed when the level is unknown. */
export function BattBar({ v, dict }: { readonly v: VehicleState; readonly dict: Dict }) {
  const unknown = v.battery.pct === null
  const cls = unknown ? 'batt unknown' : battLow(v) ? 'batt low' : 'batt'
  return (
    <span className={cls} title={unknown ? dict.battUnknown : undefined}>
      <span style={{ width: battWidth(v) }} />
    </span>
  )
}
