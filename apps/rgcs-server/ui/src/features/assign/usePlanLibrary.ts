// The saved plans for the assignment board: the summaries (`GET /api/missions`), then each full
// plan (`GET /api/missions/{id}`) through a cache keyed by id + `updated_at`, so an unchanged plan
// is fetched once. Reloads after a save or delete in the planner (`planLibraryChanged`).
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Mission, MissionSummaryRow } from '../../shared/api/types'
import { getMission, listMissions } from '../mission/api'
import { missionStore, useMissionUi, type MissionStore, type MissionUi } from '../mission/store'
import type { Workspace } from '../plans/model'
import { planSetStore, useWorkspace, type PlanSetStore } from '../plans/store'

export interface LibraryPlan {
  readonly id: number
  readonly name: string
  readonly updated_at: number
  readonly mission: Mission
  /** An open row holding this plan has unsaved edits: it cannot be dragged. */
  readonly dirty: boolean
}

export interface LibraryApi {
  readonly list: () => Promise<MissionSummaryRow[]>
  readonly get: (id: number) => Promise<Mission>
}

export interface PlanLibraryDeps {
  readonly api?: LibraryApi
  readonly plans?: PlanSetStore
  readonly editor?: MissionStore
}

export interface PlanLibrary {
  readonly plans: readonly LibraryPlan[] | null
  readonly error: string | null
  readonly reload: () => void
}

const DEFAULT_API: LibraryApi = { list: listMissions, get: getMission }

const changeListeners = new Set<() => void>()

/** Tells every mounted library that the saved plans changed (a save or delete in the planner). */
export function planLibraryChanged(): void {
  changeListeners.forEach((l) => l())
}

export function onPlanLibraryChanged(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

const cache = new Map<string, Promise<Mission>>()
const versionKey = (s: MissionSummaryRow): string => `${s.id}:${s.updated_at}`

/** Test hook: forgets every cached plan. */
export function clearPlanLibraryCache(): void {
  cache.clear()
}

function fetchPlan(api: LibraryApi, s: MissionSummaryRow): Promise<Mission> {
  const key = versionKey(s)
  const hit = cache.get(key)
  if (hit) return hit
  const p = api.get(s.id)
  cache.set(key, p)
  // a failed fetch is not cached: the next load asks again
  p.catch(() => {
    if (cache.get(key) === p) cache.delete(key)
  })
  return p
}

/** Drops cached versions that are no longer listed (older versions and deleted plans). */
function pruneCache(rows: readonly MissionSummaryRow[]): void {
  const live = new Set(rows.map(versionKey))
  for (const key of [...cache.keys()]) if (!live.has(key)) cache.delete(key)
}

type Loaded = Omit<LibraryPlan, 'dirty'>

async function loadLibrary(api: LibraryApi): Promise<readonly Loaded[]> {
  const rows = await api.list()
  pruneCache(rows)
  const missions = await Promise.all(rows.map((s) => fetchPlan(api, s)))
  return rows.map((s, i) => ({ id: s.id, name: s.name, updated_at: s.updated_at, mission: missions[i] }))
}

/** Saved ids whose open row has unsaved edits; the live editor is the truth for the active row. */
export function dirtySavedIds(ws: Workspace, live: MissionUi): ReadonlySet<number> {
  const uis = ws.rows.map((r) => (r.key === ws.active ? live : r.ui))
  return new Set(uis.filter((u) => u.dirty && u.savedId !== null).map((u) => u.savedId as number))
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function usePlanLibrary(deps: PlanLibraryDeps = {}): PlanLibrary {
  // the API is fixed at mount (a test seam), so an inline `deps` object never restarts the load
  const [api] = useState<LibraryApi>(() => deps.api ?? DEFAULT_API)
  const ws = useWorkspace(deps.plans ?? planSetStore)
  const live = useMissionUi(deps.editor ?? missionStore)
  const [loaded, setLoaded] = useState<readonly Loaded[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick((n) => n + 1), [])
  useEffect(() => onPlanLibraryChanged(reload), [reload])

  useEffect(() => {
    let stale = false
    loadLibrary(api).then(
      (rows) => {
        if (stale) return
        setLoaded(rows)
        setError(null)
      },
      (e: unknown) => {
        if (!stale) setError(errText(e))
      },
    )
    return () => {
      stale = true
    }
  }, [api, tick])

  const dirty = useMemo(() => dirtySavedIds(ws, live), [ws, live])
  const plans = useMemo(() => (loaded === null ? null : loaded.map((p) => ({ ...p, dirty: dirty.has(p.id) }))), [loaded, dirty])
  return { plans, error, reload }
}
