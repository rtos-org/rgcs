// Test fixture: a 400 m × 300 m plane survey north-east of a home, as a draft.
import type { LatLon } from '../mission/geo'
import { emptyDraft, type Draft } from '../mission/model'
import { addSurvey } from './draftOps'
import { generateSurvey } from './generate'
import { ALPHA7R4, defaultSpec, type SurveySpec } from './spec'

const O: LatLon = { lat: 36.25, lon: 139.0 }
const M_LAT = 110_540
const M_LON = 111_320 * Math.cos((36.25 * Math.PI) / 180)
/** Point `e` m east and `n` m north of O. */
export const at = (e: number, n: number): LatLon => ({ lat: O.lat + n / M_LAT, lon: O.lon + e / M_LON })

export const RECT: readonly LatLon[] = [at(0, 0), at(400, 0), at(400, 300), at(0, 300)]
export const HOME = { ...at(-100, -100), alt: 0 }

export const fixtureSpec = (o: Partial<SurveySpec> = {}): SurveySpec => ({ ...defaultSpec(RECT, ALPHA7R4, 'plane'), name: 'Field', angleDeg: 90, start: 'nw', ...o })

/** A draft holding one generated survey (and its id). */
export function surveyDraft(o: Partial<SurveySpec> = {}): { draft: Draft; id: string } {
  const spec = fixtureSpec(o)
  const gen = generateSurvey(spec, HOME)
  if ('error' in gen) throw new Error(gen.error)
  const base = emptyDraft()
  return addSurvey({ ...base, mission: { ...base.mission, home: HOME } }, null, spec, gen.items)
}
