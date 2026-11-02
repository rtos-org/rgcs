import type { VehicleState } from '../../shared/api/types'
import { IconAltitude, IconBattery, IconHouse, IconSpeed } from '../../shared/ui/icons'
import { altText, battText, homeDistText, speedText } from '../vehicles/format'

/** Altitude (a rover: distance from home) · speed · battery over the video, each behind its Lucide icon. */
export function StatLine({ v }: { readonly v: VehicleState }) {
  return (
    <>
      <span className="row" style={{ gap: 5 }}>
        {v.kind === 'rover' ? <IconHouse size={14} /> : <IconAltitude size={14} />}
        {v.kind === 'rover' ? homeDistText(v) : altText(v)}
      </span>
      <span className="row" style={{ gap: 5 }}>
        <IconSpeed size={14} />
        {speedText(v)}
      </span>
      <span className="row" style={{ gap: 5 }}>
        <IconBattery size={14} />
        {battText(v)}
      </span>
    </>
  )
}
