// Audience-page calls: token in the query string, no session, no shared 401 handler.

export interface PresentConfig {
  readonly sysid: number | null
  readonly vehicle_name: string | null
  readonly logo: boolean
  readonly map_tile_url: string
  readonly map_attribution: string
  readonly whep_path: string
}

export interface PresentVehicle {
  readonly sysid: number
  readonly name: string
  readonly lat: number
  readonly lon: number
  readonly hdg: number | null
  readonly alt_rel: number
  readonly mode: string
  readonly armed: boolean
  readonly link: 'ok' | 'delay' | 'lost'
}

export class PresentError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function get<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${path}?t=${encodeURIComponent(token)}`, { cache: 'no-store' })
  const body = (await res.json().catch(() => null)) as { success: boolean; data?: T; error?: { message: string } } | null
  if (!res.ok || !body?.success) throw new PresentError(res.status, body?.error?.message ?? `http_${res.status}`)
  return body.data as T
}

export const presentConfig = (token: string) => get<PresentConfig>('/present/config', token)
export const presentVehicle = (token: string) => get<PresentVehicle | null>('/present/vehicle', token)
export const presentWhepUrl = (token: string) => `/present/whep?t=${encodeURIComponent(token)}`
export const presentLogoUrl = (token: string) => `/present/logo?t=${encodeURIComponent(token)}`
