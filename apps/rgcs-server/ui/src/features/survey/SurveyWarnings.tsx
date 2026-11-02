// Survey warnings as caution hints: colour only, none blocks writing.
import type { Dict } from '../../shared/i18n'
import { fmtNum } from './NumField'
import type { SurveySpec } from './spec'
import type { SurveyMetrics } from './useSurvey'
import { l1DistanceM, MAX_SURVEY_ITEMS, MIN_CLEARANCE_M, suggestSkip, type SurveyWarning } from './warnings'

interface Props {
  readonly spec: SurveySpec
  readonly metrics: SurveyMetrics
  readonly dict: Dict
}

/** The clearance copy: the ground within N m under the flight altitude, or N m above it. */
function terrainText({ metrics, dict }: Props): string {
  const agl = metrics.worst?.lowAglM ?? 0
  const text = agl >= 0 ? dict.svWarnTerrain : dict.svWarnTerrainAbove
  return text.replace('{n}', fmtNum(Math.abs(agl), 0)).replace('{min}', String(MIN_CLEARANCE_M))
}

function text(code: SurveyWarning, p: Props): string {
  const { spec, metrics, dict } = p
  const g = metrics.geometry
  const copy: Record<SurveyWarning, () => string> = {
    blur: () => dict.svWarnBlur,
    interval: () => dict.svWarnInterval,
    skip: () => dict.svWarnSkip.replace('{n}', String(suggestSkip(g.spacingM, g.turnRadiusM))),
    bank: () => dict.svWarnBank,
    overlap: () => dict.svWarnOverlap,
    arc: () => dict.svWarnArc,
    entry: () => dict.svWarnEntry,
    wp_radius: () => dict.svWarnWpRadius.replace('{n}', fmtNum(spec.wpRadiusM, 0)),
    l1: () => dict.svWarnL1.replace('{r}', fmtNum(g.turnRadiusM, 0)).replace('{l1}', fmtNum(l1DistanceM(spec, metrics.vehicle), 0)),
    terrain: () => terrainText(p),
    assist: () => dict.svWarnAssist,
    cam_roll: () => dict.svWarnCamRoll,
    too_many: () => dict.svWarnTooMany.replace('{n}', String(MAX_SURVEY_ITEMS)),
    no_home: () => dict.svWarnNoHome,
  }
  return copy[code]()
}

export function SurveyWarnings(p: Props) {
  if (p.metrics.warnings.length === 0) return null
  return (
    <div className="sv-warns" data-testid="survey-warnings">
      {p.metrics.warnings.map((code) => (
        <div key={code} className="hint caution sv-warn">
          {text(code, p)}
        </div>
      ))}
    </div>
  )
}
