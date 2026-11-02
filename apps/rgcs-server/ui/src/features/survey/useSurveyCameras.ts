// The shared survey camera list: loaded once, reloaded after every change.
import { useCallback, useEffect, useState } from 'react'
import type { SurveyCamera } from '../../shared/api/types'
import { createCamera, deleteCamera, fromValues, listCameras, updateCamera, validCameraValues } from './cameraApi'
import type { SurveyCameraValues } from './spec'

/** Why the last camera action failed; `detail` is the server's message, shown only as a secondary note. */
export interface SurveyCameraError {
  readonly code: 'load_failed' | 'save_failed' | 'invalid'
  readonly detail: string | null
}

const failed = (code: SurveyCameraError['code'], e: unknown): SurveyCameraError => ({ code, detail: e instanceof Error ? e.message : String(e) })
const INVALID: SurveyCameraError = { code: 'invalid', detail: null }

export interface SurveyCameras {
  readonly cameras: readonly SurveyCamera[]
  readonly error: SurveyCameraError | null
  readonly reload: () => Promise<void>
  readonly saveAs: (values: SurveyCameraValues, name: string) => Promise<SurveyCamera | null>
  readonly update: (id: number, values: SurveyCameraValues) => Promise<SurveyCamera | null>
  readonly remove: (id: number) => Promise<true | null>
}

export function useSurveyCameras(): SurveyCameras {
  const [cameras, setCameras] = useState<readonly SurveyCamera[]>([])
  const [error, setError] = useState<SurveyCameraError | null>(null)

  const reload = useCallback(async () => {
    try {
      setCameras(await listCameras())
      setError(null)
    } catch (e) {
      setError(failed('load_failed', e))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  /** Runs a change, then refreshes the list; a failure is shown instead of thrown. */
  const change = useCallback(
    async <T,>(run: () => Promise<T>): Promise<T | null> => {
      try {
        const out = await run()
        await reload()
        return out
      } catch (e) {
        setError(failed('save_failed', e))
        return null
      }
    },
    [reload],
  )

  const guarded = useCallback(
    async (values: SurveyCameraValues, run: () => Promise<SurveyCamera>) => {
      if (!validCameraValues(values)) {
        setError(INVALID)
        return null
      }
      return change(run)
    },
    [change],
  )

  const saveAs = useCallback((values: SurveyCameraValues, name: string) => guarded(values, () => createCamera(fromValues({ ...values, name }))), [guarded])
  const update = useCallback((id: number, values: SurveyCameraValues) => guarded(values, () => updateCamera(id, { ...fromValues(values), id })), [guarded])
  const remove = useCallback((id: number) => change(async () => (await deleteCamera(id), true as const)), [change])

  return { cameras, error, reload, saveAs, update, remove }
}
