import { memo, useId } from 'react'
import type { Dict } from '../../shared/i18n'
import { DISC_R, PITCH_MARKS, ROLL_TICKS, fmtSigned, horizonTransform, rollPointerTransform } from './instruments'

interface Props {
  /** Degrees, right wing down positive; null = no data. */
  readonly roll: number | null
  /** Degrees, nose up positive; null = no data. */
  readonly pitch: number | null
  readonly dict: Dict
}

function PitchLadder() {
  return (
    <g className="ladder">
      {PITCH_MARKS.map((m) => (
        <line key={m.deg} data-part="pitch-mark" x1={-m.half} y1={m.y} x2={m.half} y2={m.y} />
      ))}
    </g>
  )
}

function RollScale() {
  return (
    <g className="roll-scale">
      <path d={`M ${-43.3} ${-25} A 50 50 0 0 1 43.3 -25`} fill="none" />
      {ROLL_TICKS.map((t) => (
        <line key={t.deg} data-part="roll-tick" x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />
      ))}
    </g>
  )
}

function AircraftSymbol() {
  return (
    <g className="aircraft">
      <path d="M -30 0 H -12 L -6 6 M 30 0 H 12 L 6 6" fill="none" />
      <circle cx={0} cy={0} r={2} />
    </g>
  )
}

/** Artificial horizon: sky/ground turned by −roll and moved by pitch, fixed aircraft and roll scale. */
export const AttitudeIndicator = memo(function AttitudeIndicator({ roll, pitch, dict }: Props) {
  const clipId = `ai-clip-${useId().replace(/:/g, '')}`
  const known = roll !== null && pitch !== null
  const r = known ? roll : 0
  const p = known ? pitch : 0
  const label = known
    ? `${dict.instAttitude} ${dict.instRoll} ${fmtSigned(roll)} ${dict.instPitch} ${fmtSigned(pitch)}`
    : `${dict.instAttitude} ${dict.instNoData}`
  return (
    <svg className={`instrument attitude${known ? '' : ' nodata'}`} viewBox="-60 -60 120 120" role="img" aria-label={label}>
      <clipPath id={clipId}>
        <circle cx={0} cy={0} r={DISC_R} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <g data-part="horizon" transform={horizonTransform(r, p)}>
          <rect className="sky" x={-200} y={-200} width={400} height={200} />
          <rect className="ground" x={-200} y={0} width={400} height={200} />
          <line className="horizon-line" x1={-200} y1={0} x2={200} y2={0} />
          <PitchLadder />
        </g>
      </g>
      <circle className="bezel" cx={0} cy={0} r={DISC_R} fill="none" />
      <RollScale />
      <path data-part="roll-pointer" className="roll-pointer" transform={rollPointerTransform(r)} d="M 0 -45 L -4 -38 H 4 Z" />
      <AircraftSymbol />
    </svg>
  )
})
