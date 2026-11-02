// Survey panel numbers: photos, shot distance / interval, blur, footprint, area, lanes,
// turn radius, distance and time, and the terrain range with the worst GSD / overlaps beside the set ones.
import type { Dict } from '../../shared/i18n'
import { km, mmss } from '../mission/labels'
import { fmtNum } from './NumField'
import { gsdCm } from './photo'
import type { SurveySpec } from './spec'
import type { SurveyMetrics } from './useSurvey'

interface Props {
  readonly spec: SurveySpec
  readonly metrics: SurveyMetrics
  readonly dict: Dict
}

const HECTARE = 10_000

const area = (m2: number): string => (m2 >= HECTARE ? `${(m2 / HECTARE).toFixed(2)} ha` : `${Math.round(m2)} m²`)

/** "set / worst": the worst value is emphasised, and marked when the overlap warning fires. */
function SetWorst({ set, worst, low, unit }: { set: string; worst: string; low: boolean; unit: string }) {
  return (
    <span>
      {`${set} / `}
      <strong className={`sv-worst${low ? ' low' : ''}`}>{worst}</strong>
      {` ${unit}`}
    </span>
  )
}

function WorstRows({ spec, metrics, dict }: Props) {
  const { ground, worst } = metrics
  if (!ground || !worst) return <div className="t3 sv-note">{dict.svNoTerrain}</div>
  const low = metrics.warnings.includes('overlap')
  return (
    <div className="num summary-grid">
      <span className="t2">{dict.svGround}</span>
      <span>{`${Math.round(ground.min)} – ${Math.round(ground.max)} m`}</span>
      <span className="t2">{dict.svGsdWorst}</span>
      <SetWorst set={fmtNum(gsdCm(spec.camera, spec.altM), 2)} worst={fmtNum(worst.gsdCm, 2)} low={false} unit="cm/px" />
      <span className="t2">{dict.svFrontWorst}</span>
      <SetWorst set={fmtNum(spec.frontPct, 0)} worst={fmtNum(worst.frontPct, 0)} low={low} unit="%" />
      <span className="t2">{dict.svSideWorst}</span>
      <SetWorst set={fmtNum(spec.sidePct, 0)} worst={fmtNum(worst.sidePct, 0)} low={low} unit="%" />
    </div>
  )
}

export function SurveyNumbers({ spec, metrics, dict }: Props) {
  const { numbers: n, geometry: g } = metrics
  return (
    <div className="sv-numbers" data-testid="survey-numbers">
      <div className="h2 sv-sub">{dict.svNumbers}</div>
      <div className="num summary-grid">
        <span className="t2">{dict.svPhotos}</span>
        <span>{dict.svPhotosN.replace('{n}', String(n.photos))}</span>
        <span className="t2">{dict.svTrigger}</span>
        <span>{`${fmtNum(g.triggerDistM, 1)} m / ${fmtNum(n.intervalS, 2)} s`}</span>
        <span className="t2">{dict.svBlur}</span>
        <span data-testid="sv-blur">{`${fmtNum(n.blur.cm, 1)} cm / ${fmtNum(n.blur.px, 2)} px`}</span>
        <span className="t2">{dict.svFootprint}</span>
        <span>{`${fmtNum(g.footprint.alongM, 0)} × ${fmtNum(g.footprint.acrossM, 0)} m`}</span>
        <span className="t2">{dict.svArea}</span>
        <span>{area(n.areaM2)}</span>
        <span className="t2">{dict.svLanes}</span>
        <span>{n.lanes}</span>
        {spec.airframe === 'plane' && (
          <>
            <span className="t2">{dict.svTurnRadius}</span>
            <span>{`${fmtNum(g.turnRadiusM, 0)} m`}</span>
          </>
        )}
        <span className="t2">{dict.svDistance}</span>
        <span>{km(n.distanceM)}</span>
        <span className="t2">{dict.svTime}</span>
        <span>{mmss(n.timeS)}</span>
      </div>
      <WorstRows spec={spec} metrics={metrics} dict={dict} />
    </div>
  )
}
