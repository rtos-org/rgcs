// The open plans' part of the planner's right panel and its sheet, wired for MissionView: the
// comparison table (two or more missions, spec 2026-10-20 §5.4) whose vehicle column lists the
// server assignments (2026-10-31 §9), and the batch write sheet (§5.5). The assignment board
// opens the sheet (`open`, 2026-10-31 §7); the table no longer does.
import type { ReactNode } from 'react'
import type { Mission, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { assignedTo } from '../assign/logic'
import { useAssignments, type Assignments } from '../assign/store'
import { vehicleStore } from '../vehicles/store'
import { BatchSheetView, type SheetLine } from './BatchWriteSheet'
import { CompareTable, type CompareLine } from './CompareTable'
import type { Workspace } from './model'
import { useBatchWrite, type PlanLine } from './useBatchWrite'

/** Like 機体に書き込む: a verified write records the mission the vehicle now holds. */
const recordMission = (to: number, m: Mission) => vehicleStore.setVehicleMission(to, { ...m, sysid: to })

/** Each line with the names of the vehicles its row's saved plan is assigned to. */
function compareLines(lines: readonly PlanLine[], ws: Workspace, assignments: Assignments, vehicles: ReadonlyMap<number, VehicleState>): CompareLine[] {
  const savedIds = new Map(ws.rows.map((r) => [r.key, r.ui.savedId]))
  const known = [...vehicles.values()]
  return lines.map((l) => ({ ...l, vehicles: assignedTo(savedIds.get(l.key) ?? null, assignments, known).map((v) => v.name) }))
}

export function usePlanSetWrite(ws: Workspace, vehicles: ReadonlyMap<number, VehicleState>, dict: Dict): { compare: ReactNode; sheet: ReactNode; open: (lines: readonly SheetLine[]) => void } {
  const batch = useBatchWrite(ws, vehicles, recordMission)
  const assignments = useAssignments()
  const lines = compareLines(batch.lines, ws, assignments, vehicles)
  return {
    open: batch.open,
    compare: lines.length >= 2 ? <CompareTable lines={lines} dict={dict} /> : null,
    sheet: batch.sheet && <BatchSheetView sheet={batch.sheet} dict={dict} onWrite={(jobs) => void batch.write(jobs)} onClose={batch.close} />,
  }
}
