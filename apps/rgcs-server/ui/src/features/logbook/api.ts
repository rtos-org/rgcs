// REST calls for the logbook: registry, pilot, templates, inspections, flights,
// squawks, maintenance, logs and the form export URL.
import { apiFetch, ApiError, CSRF_HEADER, CSRF_VALUE } from '../../shared/api/client'
import type {
  FcLogEntry,
  Flight,
  FlightInput,
  FlightLog,
  FlightPatch,
  FlightSquawk,
  FlightSquawkInput,
  InspectionRun,
  InspectionRunInput,
  InspectionTemplate,
  InspectionTemplateInput,
  MaintenanceInput,
  MaintenanceRecord,
  PilotInfo,
  PilotInput,
  VehicleRegistry,
  VehicleRegistryInput,
} from '../../shared/api/types'

export interface LogsReply {
  readonly fetch_enabled: boolean
  readonly logs: FlightLog[]
}

function range(from?: string, to?: string): string {
  const q = new URLSearchParams()
  if (from) q.set('from', from)
  if (to) q.set('to', to)
  const s = q.toString()
  return s === '' ? '' : `?${s}`
}

export const getRegistry = (sysid: number): Promise<VehicleRegistry> => apiFetch(`/api/vehicles/${sysid}/registry`)
export const putRegistry = (sysid: number, input: VehicleRegistryInput): Promise<VehicleRegistry> =>
  apiFetch(`/api/vehicles/${sysid}/registry`, { method: 'PUT', body: input })
export const getMyPilot = (): Promise<PilotInfo> => apiFetch('/api/users/me/pilot')
export const putMyPilot = (input: PilotInput): Promise<PilotInfo> => apiFetch('/api/users/me/pilot', { method: 'PUT', body: input })

export const listTemplates = (): Promise<InspectionTemplate[]> => apiFetch('/api/inspection/templates')
export const createTemplate = (input: InspectionTemplateInput): Promise<InspectionTemplate> =>
  apiFetch('/api/inspection/templates', { method: 'POST', body: input })
export const updateTemplate = (id: number, input: InspectionTemplateInput): Promise<InspectionTemplate> =>
  apiFetch(`/api/inspection/templates/${id}`, { method: 'PUT', body: input })
export const deleteTemplate = (id: number): Promise<{ deleted: boolean }> => apiFetch(`/api/inspection/templates/${id}`, { method: 'DELETE' })
export const getVehicleTemplate = (sysid: number): Promise<InspectionTemplate> => apiFetch(`/api/vehicles/${sysid}/inspections/template`)

export const listInspections = (sysid: number, from?: string, to?: string): Promise<InspectionRun[]> =>
  apiFetch(`/api/vehicles/${sysid}/inspections${range(from, to)}`)
export const createInspection = (sysid: number, input: InspectionRunInput): Promise<InspectionRun> =>
  apiFetch(`/api/vehicles/${sysid}/inspections`, { method: 'POST', body: input })

export const listFlights = (sysid: number, from?: string, to?: string): Promise<Flight[]> =>
  apiFetch(`/api/vehicles/${sysid}/flights${range(from, to)}`)
export const createFlight = (sysid: number, input: FlightInput): Promise<Flight> =>
  apiFetch(`/api/vehicles/${sysid}/flights`, { method: 'POST', body: input })
export const patchFlight = (sysid: number, id: number, patch: FlightPatch): Promise<Flight> =>
  apiFetch(`/api/vehicles/${sysid}/flights/${id}`, { method: 'PATCH', body: patch })
export const deleteFlight = (sysid: number, id: number): Promise<{ deleted: boolean }> =>
  apiFetch(`/api/vehicles/${sysid}/flights/${id}`, { method: 'DELETE' })
export const addSquawk = (sysid: number, id: number, input: FlightSquawkInput): Promise<FlightSquawk> =>
  apiFetch(`/api/vehicles/${sysid}/flights/${id}/squawks`, { method: 'POST', body: input })

export const listMaintenance = (sysid: number, from?: string, to?: string): Promise<MaintenanceRecord[]> =>
  apiFetch(`/api/vehicles/${sysid}/maintenance${range(from, to)}`)
export const createMaintenance = (sysid: number, input: MaintenanceInput): Promise<MaintenanceRecord> =>
  apiFetch(`/api/vehicles/${sysid}/maintenance`, { method: 'POST', body: input })

export const listLogs = (sysid: number): Promise<LogsReply> => apiFetch(`/api/vehicles/${sysid}/logs`)
export const listFcLogs = (sysid: number): Promise<FcLogEntry[]> => apiFetch(`/api/vehicles/${sysid}/logs/fc`)
export const fetchLog = (sysid: number, fcLogId: number, flightId?: number | null): Promise<{ fc_log_id: number }> =>
  apiFetch(`/api/vehicles/${sysid}/logs/fetch`, { method: 'POST', body: { fc_log_id: fcLogId, flight_id: flightId ?? null } })
export const attachLog = (sysid: number, id: number, flightId: number | null): Promise<FlightLog> =>
  apiFetch(`/api/vehicles/${sysid}/logs/${id}`, { method: 'PATCH', body: { flight_id: flightId } })

/** Raw-body upload (not JSON): the CSRF header rides along, the file is the body. */
export async function uploadLog(sysid: number, file: File, flightId?: number | null): Promise<FlightLog> {
  const q = new URLSearchParams({ filename: file.name })
  if (flightId !== undefined && flightId !== null) q.set('flight_id', String(flightId))
  let res: Response
  try {
    res = await fetch(`/api/vehicles/${sysid}/logs/upload?${q.toString()}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { [CSRF_HEADER]: CSRF_VALUE, 'content-type': 'application/octet-stream' },
      body: file,
    })
  } catch (e) {
    throw new ApiError(0, 'network', e instanceof Error ? e.message : 'network error')
  }
  const parsed = (await res.json().catch(() => null)) as { success?: boolean; data?: FlightLog; error?: { code: string; message: string } } | null
  if (parsed?.success && parsed.data) return parsed.data
  throw new ApiError(res.status, parsed?.error?.code ?? `http_${res.status}`, parsed?.error?.message ?? res.statusText)
}

export type FormNumber = 1 | 2 | 3

/** Plain GET URL (cookie-authenticated) for `<a download>`. */
export function exportUrl(sysid: number, form: FormNumber, from: string, to: string, format: 'pdf' | 'csv'): string {
  const q = new URLSearchParams({ form: String(form), from, to, format })
  return `/api/vehicles/${sysid}/logbook/export?${q.toString()}`
}

export function logFileUrl(sysid: number, id: number): string {
  return `/api/vehicles/${sysid}/logs/${id}/file`
}
