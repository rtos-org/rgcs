import { apiFetch } from '../../shared/api/client'
import type { RoiControl, RoiTarget } from '../../shared/api/types'

const base = (sysid: number) => `/api/vehicles/${sysid}/roi`

export function getRoiTargets(sysid: number): Promise<RoiTarget[]> {
  return apiFetch(`${base(sysid)}/targets`)
}

export function putRoiTargets(sysid: number, targets: readonly RoiTarget[]): Promise<RoiTarget[]> {
  return apiFetch(`${base(sysid)}/targets`, { method: 'PUT', body: targets })
}

export function getRoiControl(sysid: number): Promise<RoiControl> {
  return apiFetch(`${base(sysid)}/control`)
}

export function putRoiControl(sysid: number, c: RoiControl): Promise<RoiControl> {
  return apiFetch(`${base(sysid)}/control`, { method: 'PUT', body: c })
}

export function startRoi(sysid: number, id: string): Promise<void> {
  return apiFetch<void>(`${base(sysid)}/start`, { method: 'POST', body: { id } })
}

export function stopRoi(sysid: number): Promise<{ stopped: boolean }> {
  return apiFetch(`${base(sysid)}/stop`, { method: 'POST' })
}
