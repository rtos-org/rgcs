// REST calls for parameters (`/params`, `/history/params`).
import { apiFetch } from '../../shared/api/client'
import type { ParamChange, ParamEntry, ParamHistoryEntry, ParamProgress, ParamWriteResult } from '../../shared/api/types'

export interface ParamsReply {
  readonly entries: ParamEntry[]
  readonly progress: ParamProgress
}

export const getParams = (sysid: number): Promise<ParamsReply> => apiFetch(`/api/vehicles/${sysid}/params`)
export const refreshParams = (sysid: number): Promise<ParamProgress> => apiFetch(`/api/vehicles/${sysid}/params/refresh`, { method: 'POST' })
export const writeParams = (sysid: number, changes: ParamChange[], confirmToken: string): Promise<ParamWriteResult[]> =>
  apiFetch(`/api/vehicles/${sysid}/params`, { method: 'PUT', body: { changes, confirm_token: confirmToken } })
export const getParamHistory = (sysid: number | null, limit = 200): Promise<ParamHistoryEntry[]> =>
  apiFetch(`/api/history/params?limit=${limit}${sysid === null ? '' : `&sysid=${sysid}`}`)
