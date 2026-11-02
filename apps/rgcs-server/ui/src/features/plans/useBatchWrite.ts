// State and orchestration of the plan comparison table and 割当どおり書き込む (spec 2026-10-20
// §5.4 / §5.5), kept out of MissionView. Missing rows are not compared. The assignment board
// opens the sheet with its lines (2026-10-31 §7): saved plans, fence → rally → mission.
import { useEffect, useMemo, useRef } from 'react'
import type { Mission, VehicleState } from '../../shared/api/types'
import { readFence, readRally, uploadMission, uploadSavedMission, validateMission, writeFence, writeRally } from '../mission/api'
import { leftovers, runBatch, type BatchDeps, type BatchJob } from './batch'
import { batchStore, useBatchSheet, type BatchStore } from './batchStore'
import type { SheetLine } from './BatchWriteSheet'
import { compareRows, type CompareRow } from './compare'
import type { Row, Workspace } from './model'
import { useEndurance } from './useEndurance'

type Vehicles = ReadonlyMap<number, VehicleState>

/** One open row's figures, with its edit-mode target vehicle's name (null = none). */
export interface PlanLine extends CompareRow {
  readonly color: string
  readonly name: string
  readonly vehicle: string | null
}
const vehicleName = (vehicles: Vehicles, sysid: number): string => vehicles.get(sysid)?.name ?? `#${sysid}`

const figuresFor = (rows: readonly Row[], endurance: ReadonlyMap<number, number | null>): readonly CompareRow[] =>
  compareRows(rows.map((r) => ({ key: r.key, draft: r.ui.history.present, enduranceMin: r.sysid === null ? null : (endurance.get(r.sysid) ?? null) })))

type OnVerified = (sysid: number, mission: Mission) => void

/** The real API; a verified mission write reports the mission the vehicle now holds (`onVerified`). */
function batchDeps(jobs: readonly BatchJob[], onVerified: OnVerified, connected: (sysid: number) => boolean): BatchDeps {
  const verified = <T extends { verified: boolean }>(sysid: number, mission: Mission | undefined, report: T): T => {
    if (report.verified && mission !== undefined) onVerified(sysid, mission)
    return report
  }
  const savedMission = (sysid: number, id: number) => jobs.find((j) => j.sysid === sysid && j.savedId === id)?.mission
  return {
    validate: validateMission,
    upload: async (sysid, mission) => verified(sysid, mission, await uploadMission(sysid, mission)),
    uploadSaved: async (sysid, id) => verified(sysid, savedMission(sysid, id), await uploadSavedMission(sysid, id)),
    writeFence,
    writeRally,
    connected,
  }
}

/** `onVerified`: a vehicle's read-back matched (the caller records the mission it now holds). */
export function useBatchWrite(ws: Workspace, vehicles: Vehicles, onVerified: OnVerified, store: BatchStore = batchStore) {
  const rows = useMemo(() => ws.rows.filter((r) => !r.missing), [ws])
  const endurance = useEndurance(rows.flatMap((r) => (r.sysid === null ? [] : [r.sysid])))
  // the figures follow the plans; the names follow the telemetry (which updates far more often)
  const figures = useMemo(() => figuresFor(rows, endurance), [rows, endurance])
  const lines: PlanLine[] = rows.map((r, i) => ({ ...figures[i]!, color: r.color, name: r.ui.history.present.mission.name, vehicle: r.sysid === null ? null : vehicleName(vehicles, r.sysid) }))
  const sheet = useBatchSheet(store)
  const latest = useRef(vehicles)
  useEffect(() => {
    latest.current = vehicles
  }, [vehicles])
  const busy = () => store.getState()?.running === true

  /** Opens the sheet for `picked`; not while a batch runs (its sheet stays) and not for nothing. */
  const open = (picked: readonly SheetLine[]) => {
    if (busy() || picked.length === 0) return
    const id = store.nextSession()
    store.update(() => ({ session: id, lines: picked, leftovers: null, states: new Map(), running: false }))
    void leftovers(picked, { fence: readFence, rally: readRally }).then((left) => store.patch(id, (s) => ({ ...s, leftovers: left })))
  }

  const connected = (sysid: number) => {
    const v = latest.current.get(sysid)
    return v !== undefined && v.link !== 'lost'
  }

  /** Refused while a batch runs; the running flag is set before the first await. */
  const write = async (jobs: readonly BatchJob[]) => {
    const current = store.getState()
    if (current === null || current.running) return
    const id = current.session
    store.patch(id, (s) => ({ ...s, running: true }))
    try {
      await runBatch(jobs, batchDeps(jobs, onVerified, connected), (st) => store.patch(id, (s) => ({ ...s, states: new Map([...s.states, [st.key, st]]) })), { missionLast: true })
    } finally {
      store.patch(id, (s) => ({ ...s, running: false }))
    }
  }

  const close = () => store.update((s) => (s?.running ? s : null))

  return { lines, canWrite: !sheet?.running, sheet, open, write, close }
}
