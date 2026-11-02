// REST calls for plan assignments (which saved plan each vehicle should carry). Server state:
// every change is also broadcast as an `assignments` WS frame.
import { apiFetch } from '../../shared/api/client'
import type { Assignment } from '../../shared/api/types'

export const listAssignments = (): Promise<Assignment[]> => apiFetch('/api/assignments')

/** `planId` null unassigns. 404 `not_found` for an unknown plan. */
export const putAssignment = (sysid: number, planId: number | null): Promise<Assignment> =>
  apiFetch(`/api/assignments/${sysid}`, { method: 'PUT', body: { plan_id: planId } })
