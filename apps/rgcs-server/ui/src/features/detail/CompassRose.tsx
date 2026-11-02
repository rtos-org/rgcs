import { memo } from 'react'
import type { Dict } from '../../shared/i18n'
import type { ModelKey } from '../map/models/meshes'
import { COMPASS_TICKS, compassTransform, fmtHeading } from './instruments'
import { VehicleGlyph } from './VehicleGlyph'

interface Props {
  /** Heading, degrees true; null = no data. */
  readonly hdg: number | null
  /** Course over ground, degrees; drawn as a small mark on the card when known. */
  readonly cog?: number | null
  /** The airframe drawn in the middle (as the 3D model picks it); a plane by default. */
  readonly frame?: ModelKey
  readonly dict: Dict
}

function Card({ cog }: { readonly cog: number | null }) {
  return (
    <>
      <circle className="card-ring" cx={0} cy={0} r={52} fill="none" />
      {COMPASS_TICKS.map((t) => (
        <line key={t.deg} data-part="tick" className={t.label ? 'major' : undefined} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />
      ))}
      {COMPASS_TICKS.filter((t) => t.label !== null).map((t) => (
        <text key={t.deg} className={t.label === 'N' ? 'north' : undefined} x={t.lx} y={t.ly} transform={`rotate(${t.deg} ${t.lx} ${t.ly})`}>
          {t.label}
        </text>
      ))}
      {cog !== null && <path data-part="cog" className="cog" transform={`rotate(${Math.round(cog * 10) / 10})`} d="M 0 -52 L 3.5 -46 L 0 -40 L -3.5 -46 Z" />}
    </>
  )
}

/** Compass rose: the card turns by −heading under a fixed lubber line and aircraft. */
export const CompassRose = memo(function CompassRose({ hdg, cog = null, frame = 'plane', dict }: Props) {
  const known = hdg !== null
  const course = known && cog !== null && Number.isFinite(cog) ? cog : null
  const label = known ? `${dict.instHeading} ${fmtHeading(hdg)}` : `${dict.instHeading} ${dict.instNoData}`
  return (
    <svg className={`instrument compass${known ? '' : ' nodata'}`} viewBox="-60 -60 120 120" role="img" aria-label={label}>
      <circle className="dial" cx={0} cy={0} r={56} />
      <g data-part="card" transform={compassTransform(known ? hdg : 0)}>
        <Card cog={course} />
      </g>
      <path className="lubber" d="M 0 -50 L -4 -58 H 4 Z" />
      <VehicleGlyph frame={frame} />
    </svg>
  )
})
