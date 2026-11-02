// Survey editing for the panel: reads a survey (with its live preview), regenerates its items on a
// change (one undo step), and derives the numbers, terrain worst case and warnings per spec.
import { useCallback, useMemo, useState } from 'react'
import type { MissionItem } from '../../shared/api/types'
import { planeParams } from '../flightpath/params'
import type { ElevAt } from '../map/air'
import type { LatLon } from '../mission/geo'
import type { Predicted } from '../mission/missionAir'
import type { Draft, DraftSurvey } from '../mission/model'
import { expandSurvey, regenerateSurvey, surveyAt } from './draftOps'
import { generateSurvey, surveyNumbers, type GenerateError, type SurveyGeometry, type SurveyNumbers } from './generate'
import { surveySpecSchema, type SurveySpec } from './spec'
import { useFramePreview } from './useFramePreview'
import { surveyVehicle, type SurveyVehicle } from './vehicleParams'
import { surveyWarnings, type SurveyWarning } from './warnings'
import { groundRange, worstCase, type GroundRange, type WorstCase } from './worst'

export interface SurveyArgs {
  readonly draft: Draft
  /** Commits one undo step. */
  readonly change: (fn: (d: Draft) => Draft) => void
  readonly home: LatLon | null
  /** Terrain sampler, null without DEM tiles. */
  readonly elevAt: ElevAt | null
  /** Parameters read from the connected vehicle (name → value); ROLL_LIMIT_DEG feeds the bank check. */
  readonly vehicleParams: ReadonlyMap<string, number>
  /** The predicted flight for a draft (plane entry check); absent without a vehicle model. */
  readonly predict?: (d: Draft) => Predicted | null
  /** Bumps when terrain tiles arrive, so cached metrics are recomputed. */
  readonly terrainTick?: number
}

export interface SurveyMetrics {
  readonly spec: SurveySpec
  readonly items: readonly MissionItem[]
  readonly geometry: SurveyGeometry
  readonly numbers: SurveyNumbers
  readonly ground: GroundRange | null
  readonly worst: WorstCase | null
  readonly warnings: readonly SurveyWarning[]
  /** ROLL_LIMIT_DEG of the connected vehicle, when read. */
  readonly rollLimitDeg?: number
  /** The other parameters the warnings read from the vehicle. */
  readonly vehicle: SurveyVehicle
}

/** `live`: a drag in progress (preview, once per frame); `done`: its release (commit); none: a typed value (commit). */
export type UpdatePhase = 'live' | 'done'

interface Preview {
  readonly id: string
  readonly spec: SurveySpec
}

interface MetricsCtx {
  readonly draft: Draft
  readonly id: string
  readonly home: LatLon | null
  readonly elevAt: ElevAt | null
  readonly rollLimitDeg?: number
  readonly vehicle: SurveyVehicle
  readonly predict?: (d: Draft) => Predicted | null
  /** A drag preview: no predictor run; the committed survey's `entry` result is carried over. */
  readonly carryEntry?: boolean
}

function computeMetrics(spec: SurveySpec, c: MetricsCtx): SurveyMetrics | null {
  const gen = generateSurvey(spec, c.home)
  if ('error' in gen) return null
  const { items, geometry } = gen
  const numbers = surveyNumbers(spec, geometry, items)
  const ground = c.elevAt ? groundRange(spec.polygon, c.elevAt) : null
  const homeAmsl = c.elevAt && c.home ? c.elevAt(c.home.lon, c.home.lat) : null
  const worst = ground && homeAmsl !== null ? worstCase(spec, geometry, ground, homeAmsl) : null
  const pred = spec.airframe === 'plane' && c.predict ? c.predict(regenerateSurvey(c.draft, c.id, spec, items)) : null
  const checked = surveyWarnings({ spec, geometry, numbers, worst, items, home: c.home, predicted: pred?.points, predictedMissionEnd: pred?.missionEnd, rollLimitDeg: c.rollLimitDeg, vehicle: c.vehicle })
  const warnings = c.carryEntry && !checked.includes('entry') ? [...checked, 'entry' as const] : checked
  return { spec, items, geometry, numbers, ground, worst, warnings, rollLimitDeg: c.rollLimitDeg, vehicle: c.vehicle }
}

/** Why the last change was not applied: no lanes fit, it would be too large, or the spec is out of range. */
export type SurveyRejection = GenerateError | 'invalid_spec'

/** Validates and regenerates; returns the regenerated draft updater, or why it cannot be applied. */
function regenerate(id: string, spec: SurveySpec, home: LatLon | null): ((d: Draft) => Draft) | SurveyRejection {
  if (!surveySpecSchema.safeParse(spec).success) return 'invalid_spec'
  const gen = generateSurvey(spec, home)
  if ('error' in gen) return gen.error
  return (d) => regenerateSurvey(d, id, spec, gen.items)
}

/** A release without a drag, or a value typed back unchanged, is not an edit. */
const isNoop = (base: SurveySpec, patch: Partial<SurveySpec>): boolean => (Object.keys(patch) as (keyof SurveySpec)[]).every((k) => patch[k] === base[k])

/** The last rejection and the survey it was raised for (only that survey's panel shows it). */
function useRejection() {
  const [last, setLast] = useState<{ readonly id: string; readonly reason: SurveyRejection } | null>(null)
  const set = useCallback((id: string, reason: SurveyRejection | null) => setLast(reason ? { id, reason } : null), [])
  const rejectedFor = (id: string): SurveyRejection | null => (last?.id === id ? last.reason : null)
  return { rejected: last?.reason ?? null, rejectedFor, set }
}

type MetricsArgs = Pick<SurveyArgs, 'draft' | 'home' | 'elevAt' | 'vehicleParams' | 'predict' | 'terrainTick'> & { readonly preview: Preview | null }

/** Metrics per survey, cached on the spec object; a drag preview skips the predictor and keeps the committed entry check. */
function useMetrics({ draft, home, elevAt, vehicleParams, predict, terrainTick = 0, preview }: MetricsArgs) {
  const rollLimitDeg = vehicleParams.has('ROLL_LIMIT_DEG') ? planeParams(vehicleParams).params.rollLimitDeg : undefined
  // by value: a fresh parameter map with the same values keeps the cached metrics
  const vehicleKey = JSON.stringify(surveyVehicle(vehicleParams))
  const vehicle = useMemo<SurveyVehicle>(() => JSON.parse(vehicleKey), [vehicleKey])
  const [hLat, hLon] = [home?.lat, home?.lon]
  // a new cache whenever the inputs besides the spec change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cache = useMemo(() => new WeakMap<SurveySpec, SurveyMetrics | null>(), [hLat, hLon, elevAt, terrainTick, rollLimitDeg, vehicle, predict])
  const metricsOf = (id: string, spec: SurveySpec, carryEntry?: boolean): SurveyMetrics | null => {
    const live = carryEntry !== undefined
    if (!cache.has(spec)) cache.set(spec, computeMetrics(spec, { draft, id, home, elevAt, rollLimitDeg, vehicle, predict: live ? undefined : predict, carryEntry }))
    return cache.get(spec) ?? null
  }
  return (id: string): SurveyMetrics | null => {
    const committed = draft.surveys.find((s) => s.id === id)?.spec
    const settled = committed ? metricsOf(id, committed) : null
    if (preview?.id !== id) return settled
    return metricsOf(id, preview.spec, settled?.warnings.includes('entry') ?? false)
  }
}

export function useSurvey({ draft, change, home, elevAt, vehicleParams, predict, terrainTick = 0 }: SurveyArgs) {
  const frames = useFramePreview<Preview>()
  const rejection = useRejection()
  const setRejected = rejection.set
  const update = useCallback(
    (id: string, patch: Partial<SurveySpec>, phase?: UpdatePhase) => {
      const held = frames.pending()
      const base = held?.id === id ? held.spec : draft.surveys.find((s) => s.id === id)?.spec
      if (!base) return
      const spec = { ...base, ...patch }
      if (phase === 'live') {
        setRejected(id, null)
        frames.live({ id, spec })
        return
      }
      if (held?.id !== id && isNoop(base, patch)) return
      frames.take()
      const next = regenerate(id, spec, home)
      setRejected(id, typeof next === 'string' ? next : null)
      if (typeof next !== 'string') change(next)
    },
    [frames, draft, home, change, setRejected],
  )
  const surveyFor = (uid: number): DraftSurvey | null => {
    const s = surveyAt(draft, uid)
    const spec = s && frames.preview?.id === s.id ? frames.preview.spec : s?.spec
    return s && spec ? { ...s, spec } : s
  }
  const metrics = useMetrics({ draft, home, elevAt, vehicleParams, predict, terrainTick, preview: frames.preview })
  const expand = (id: string) => change((d) => expandSurvey(d, id))
  /** Ends a drag without committing it (its handle went away mid-drag). */
  const cancel = useCallback(() => void frames.take(), [frames])
  /** The survey being dragged (its spec as of the last frame); null when no drag is in progress. */
  const preview = frames.preview
  return { surveyFor, update, expand, metrics, rejected: rejection.rejected, rejectedFor: rejection.rejectedFor, preview, cancel }
}
