import { apiFetch } from '../../shared/api/client'
import type { GimbalInputProfile } from '../../shared/api/types'

export function getGimbalProfile(): Promise<GimbalInputProfile> {
  return apiFetch<GimbalInputProfile>('/api/settings/input/gimbal')
}

export function putGimbalProfile(profile: GimbalInputProfile): Promise<GimbalInputProfile> {
  return apiFetch<GimbalInputProfile>('/api/settings/input/gimbal', { method: 'PUT', body: profile })
}
