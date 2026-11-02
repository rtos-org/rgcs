import { apiFetch } from '../../shared/api/client'

export type AltMode = 'keep' | 'set'

export interface GuidedBody {
  readonly lat: number
  readonly lon: number
  readonly alt_mode: AltMode
  readonly alt_rel?: number
  readonly confirm_token?: string
}

export interface GuidedReply {
  readonly id: number
  readonly warning: string | null
}

/** `POST /api/vehicles/{sysid}/guided`. */
export function sendGuided(sysid: number, body: GuidedBody): Promise<GuidedReply> {
  return apiFetch<GuidedReply>(`/api/vehicles/${sysid}/guided`, { method: 'POST', body })
}
