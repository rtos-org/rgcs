import { describe, expect, it } from 'vitest'
import { PLANE_DEFAULTS } from '../flightpath/params'
import { predictPlane } from '../flightpath/planePath'
import { emptyDraft } from '../mission/model'
import { HOME, surveyDraft } from './surveyFixture'
import { predictSurvey } from './surveyPredict'

describe('predictSurvey (no vehicle connected)', () => {
  it('flies the plan with the plane defaults set to the survey speed, bank and WP radius', () => {
    const { draft } = surveyDraft({ speedMs: 20, bankDeg: 35, wpRadiusM: 60 })
    const p = predictSurvey(draft)
    expect(p).not.toBeNull()
    expect(p!.home).toEqual({ lat: HOME.lat, lon: HOME.lon })
    expect(p!.points).toEqual(predictPlane(draft.items, HOME, { ...PLANE_DEFAULTS, airspeed: 20, rollLimitDeg: 35, wpRadius: 60 }))
  })

  it('nothing to predict without a plane survey or without a home', () => {
    expect(predictSurvey(emptyDraft())).toBeNull()
    expect(predictSurvey(surveyDraft({ airframe: 'copter', speedMs: 8 }).draft)).toBeNull()
    const { draft } = surveyDraft()
    expect(predictSurvey({ ...draft, mission: { ...draft.mission, home: null } })).toBeNull()
  })
})
