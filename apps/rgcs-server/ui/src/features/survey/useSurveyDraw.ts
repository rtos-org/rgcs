// Drawing a survey area on the map (click vertices, drag them, Enter / first vertex to finish, Esc to cancel)
// or taking one from a KML file: either way the survey is generated with the defaults and inserted
// after the selected item as one undo step, then selected.
import { useState } from 'react'
import type { SurveyCamera } from '../../shared/api/types'
import type { LatLon } from '../mission/geo'
import type { Draft } from '../mission/model'
import { creationSpec, type DrawVehicle } from './creationSpec'
import { addSurvey } from './draftOps'
import { generateSurvey, type GenerateError } from './generate'

export type { DrawVehicle } from './creationSpec'

interface Args {
  /** Commits one undo step. */
  readonly change: (fn: (d: Draft) => Draft) => void
  /** The survey goes after this item (after its whole survey when inside one); null = at the end. */
  readonly afterUid: number | null
  readonly home: LatLon | null
  readonly cameras: readonly SurveyCamera[]
  readonly vehicle: DrawVehicle | null
  /** Selects the new survey's first item (its panel opens). */
  readonly select: (uid: number) => void
}

const MIN_VERTICES = 3

export type DrawError = GenerateError

export function useSurveyDraw({ change, afterUid, home, cameras, vehicle, select }: Args) {
  const [drawing, setDrawing] = useState<readonly LatLon[] | null>(null)
  const [error, setError] = useState<DrawError | null>(null)

  /** Generates and inserts the survey; false when no lane fits the polygon. */
  const create = (ring: readonly LatLon[], name: string | null): boolean => {
    const base = creationSpec(ring, cameras, vehicle)
    const gen = generateSurvey(base, home)
    if ('error' in gen) {
      setError(gen.error)
      return false
    }
    let first: number | null = null
    change((d) => {
      const spec = { ...base, name: name ?? String(d.surveys.length + 1) }
      const added = addSurvey(d, afterUid, spec, gen.items)
      first = added.draft.surveys.find((s) => s.id === added.id)?.uids[0] ?? null
      return added.draft
    })
    setError(null)
    if (first !== null) select(first)
    return true
  }

  const start = () => {
    setError(null)
    setDrawing([])
  }
  const addVertex = (p: LatLon) => setDrawing((ring) => (ring ? [...ring, { lat: p.lat, lon: p.lon }] : ring))
  const moveVertex = (i: number, p: LatLon) => setDrawing((ring) => (ring ? ring.map((v, j) => (j === i ? { lat: p.lat, lon: p.lon } : v)) : ring))
  const cancel = () => {
    setError(null)
    setDrawing(null)
  }
  const finish = () => {
    if (!drawing || drawing.length < MIN_VERTICES) return
    if (create(drawing, null)) setDrawing(null)
  }
  const fromKml = (ring: readonly LatLon[], name: string) => {
    if (create(ring, name)) setDrawing(null)
  }

  const dismissError = () => setError(null)

  return { drawing, error, start, addVertex, moveVertex, finish, cancel, fromKml, dismissError }
}
