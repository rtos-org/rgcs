// REST calls for missions. JSON goes through `apiFetch`; the `.waypoints`
// text endpoints use fetch directly because they are not JSON envelopes.
import { ApiError, CSRF_HEADER, CSRF_VALUE, apiFetch } from '../../shared/api/client'
import { requestConfirm } from '../commands/api'
import { writeParams } from '../params/api'
import type { FenceParams, FenceZone, Finding, Mission, MissionStats, MissionSummaryRow, RallyPoint, UploadReport } from '../../shared/api/types'

export const listMissions = (): Promise<MissionSummaryRow[]> => apiFetch('/api/missions')
export const getMission = (id: number): Promise<Mission> => apiFetch(`/api/missions/${id}`)
export const createMission = (m: Mission): Promise<Mission> => apiFetch('/api/missions', { method: 'POST', body: m })
export const updateMission = (id: number, m: Mission): Promise<Mission> => apiFetch(`/api/missions/${id}`, { method: 'PUT', body: m })
export const deleteMission = (id: number): Promise<void> => apiFetch(`/api/missions/${id}`, { method: 'DELETE' })

export const uploadMission = (sysid: number, m: Mission): Promise<UploadReport> => apiFetch(`/api/vehicles/${sysid}/mission`, { method: 'PUT', body: m })
export const uploadSavedMission = (sysid: number, id: number): Promise<UploadReport> =>
  apiFetch(`/api/vehicles/${sysid}/mission/upload`, { method: 'POST', body: { mission_id: id } })
export const downloadMission = (sysid: number): Promise<Mission> => apiFetch(`/api/vehicles/${sysid}/mission`)
/** The mission the server last wrote to / read from the vehicle (null when none). */
export const getKnownMission = (sysid: number): Promise<Mission | null> => apiFetch(`/api/vehicles/${sysid}/mission/known`)

/** Fence (`MAV_MISSION_TYPE_FENCE`) and rally (`_RALLY`) lists: written, read back and compared. */
export const writeFence = (sysid: number, zones: readonly FenceZone[]): Promise<UploadReport> => apiFetch(`/api/vehicles/${sysid}/fence`, { method: 'PUT', body: { zones } })
export const readFence = (sysid: number): Promise<{ zones: FenceZone[] }> => apiFetch(`/api/vehicles/${sysid}/fence`)
export const writeRally = (sysid: number, points: readonly RallyPoint[]): Promise<UploadReport> => apiFetch(`/api/vehicles/${sysid}/rally`, { method: 'PUT', body: { points } })
export const readRally = (sysid: number): Promise<{ points: RallyPoint[] }> => apiFetch(`/api/vehicles/${sysid}/rally`)

/** FENCE_ENABLE / FENCE_ALT_MAX / FENCE_TYPE as the vehicle reported them. */
export const readFenceParams = (sysid: number): Promise<FenceParams> => apiFetch(`/api/vehicles/${sysid}/fence/params`)

/** Sets FENCE_ALT_MAX (a confirmed parameter write); true when the vehicle echoed the value. */
export async function setFenceAltMax(sysid: number, value: number): Promise<boolean> {
  const { confirm_token } = await requestConfirm(sysid, 'param_write')
  const [result] = await writeParams(sysid, [{ name: 'FENCE_ALT_MAX', value }], confirm_token)
  return result?.verified === true
}

export function validateMission(m: Mission, sysid: number | null): Promise<{ findings: Finding[]; stats: MissionStats }> {
  const q = sysid === null ? '' : `?sysid=${sysid}`
  return apiFetch(`/api/missions/validate${q}`, { method: 'POST', body: m })
}

async function failure(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } }
    return new ApiError(res.status, body.error?.code ?? `http_${res.status}`, body.error?.message ?? res.statusText)
  } catch {
    return new ApiError(res.status, `http_${res.status}`, res.statusText)
  }
}

/** The QGC WPL 110 text of a saved mission. */
export async function exportWaypoints(id: number): Promise<string> {
  const res = await fetch(`/api/missions/${id}/export?format=waypoints`, { credentials: 'same-origin', headers: { [CSRF_HEADER]: CSRF_VALUE } })
  if (!res.ok) throw await failure(res)
  return res.text()
}

/** Parses a `.waypoints` file on the server; the result is not saved. */
export function importWaypoints(text: string, name: string): Promise<Mission> {
  return fetch('/api/missions/import', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { [CSRF_HEADER]: CSRF_VALUE, 'content-type': 'text/plain; charset=utf-8', 'X-Mission-Name': name },
    body: text,
  }).then(async (res) => {
    const body = (await res.json().catch(() => null)) as { success: boolean; data?: Mission; error?: { code: string; message: string } } | null
    if (!res.ok || !body?.success || !body.data) throw new ApiError(res.status, body?.error?.code ?? `http_${res.status}`, body?.error?.message ?? res.statusText)
    return body.data
  })
}
