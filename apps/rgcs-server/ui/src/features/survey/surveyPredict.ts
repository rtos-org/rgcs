// The predicted line with no vehicle connected: the plan flown by the plane model with its default
// parameters, except the speed, bank and WP radius the (first) plane survey is planned with.
import { PLANE_DEFAULTS } from '../flightpath/params'
import { predictFor, type PathModel } from '../flightpath/predict'
import type { Predicted } from '../mission/missionAir'
import type { Draft } from '../mission/model'

function surveyModel(d: Draft): PathModel | null {
  const s = d.surveys.find((x) => x.spec.airframe === 'plane')
  if (!s) return null
  const { speedMs, bankDeg, wpRadiusM } = s.spec
  return { kind: 'plane', params: { ...PLANE_DEFAULTS, airspeed: speedMs, rollLimitDeg: bankDeg, wpRadius: wpRadiusM } }
}

/** Null without a plane survey or a home to start from. */
export function predictSurvey(d: Draft): Predicted | null {
  const model = surveyModel(d)
  return model ? predictFor(d, model, null) : null
}
