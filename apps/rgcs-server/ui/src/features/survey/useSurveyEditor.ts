// The one survey editor of the mission screen, shared by the panel (fields) and the map (vertex and
// rotate drags): a drag in either previews in both, and its release is one undo step.
import { useMemo, useState } from 'react'
import { TerrainSampler } from '../map/terrain'
import type { LatLon } from '../mission/geo'
import type { Predicted } from '../mission/missionAir'
import type { Draft } from '../mission/model'
import { regenerateSurvey } from './draftOps'
import { useSurvey } from './useSurvey'

/** What the mission screen hands the survey editor besides the draft. */
export interface SurveyContext {
  /** Commits one undo step. */
  readonly change: (fn: (d: Draft) => Draft) => void
  readonly home: LatLon | null
  /** Terrarium DEM tiles for the ground range; null = no terrain. */
  readonly terrainTiles: string | null
  /** The connected vehicle's parameters (ROLL_LIMIT_DEG shown beside the bank). */
  readonly vehicleParams: ReadonlyMap<string, number>
  readonly predict?: (d: Draft) => Predicted | null
}

export type SurveyEditor = ReturnType<typeof useSurvey>

/** The DEM sampler (same source as the elevation sheet) and a counter that bumps as tiles arrive. */
function useTerrain(terrainTiles: string | null) {
  const [tick, setTick] = useState(0)
  const sampler = useMemo(() => (terrainTiles ? new TerrainSampler(terrainTiles, () => setTick((n) => n + 1)) : null), [terrainTiles])
  return { elevAt: sampler ? sampler.elevAt : null, tick }
}

export function useSurveyEditor({ draft, change, home, terrainTiles, vehicleParams, predict }: SurveyContext & { readonly draft: Draft }): SurveyEditor {
  const terrain = useTerrain(terrainTiles)
  return useSurvey({ draft, change, home, elevAt: terrain.elevAt, vehicleParams, predict, terrainTick: terrain.tick })
}

/** The draft with a survey drag in progress applied (its spec, and its items when lanes fit). */
export function previewDraft(draft: Draft, sv: SurveyEditor): Draft {
  const p = sv.preview
  if (!p) return draft
  const m = sv.metrics(p.id)
  if (m) return regenerateSurvey(draft, p.id, p.spec, m.items)
  return { ...draft, surveys: draft.surveys.map((s) => (s.id === p.id ? { ...s, spec: p.spec } : s)) }
}
