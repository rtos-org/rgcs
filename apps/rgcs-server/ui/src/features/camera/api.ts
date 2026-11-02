import { apiFetch } from '../../shared/api/client'
import type { CameraCaps, CameraCommand, CameraProfile, CameraState } from '../../shared/api/types'

export function getCamera(sysid: number): Promise<{ caps: CameraCaps; state: CameraState }> {
  return apiFetch(`/api/vehicles/${sysid}/camera`)
}

export function sendCameraCommand(sysid: number, cmd: CameraCommand): Promise<void> {
  return apiFetch<void>(`/api/vehicles/${sysid}/camera/command`, { method: 'POST', body: cmd })
}

export function getCameraProfile(sysid: number): Promise<CameraProfile> {
  return apiFetch(`/api/vehicles/${sysid}/camera/profile`)
}

export function putCameraProfile(sysid: number, patch: Partial<CameraProfile>): Promise<CameraProfile> {
  return apiFetch(`/api/vehicles/${sysid}/camera/profile`, { method: 'PUT', body: patch })
}

export const whepUrl = (sysid: number) => `/api/vehicles/${sysid}/video/whep`
