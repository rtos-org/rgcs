// Save / open / file / vehicle I/O for the mission view. Every network call reports through the
// footer pills (`vehicleStore.pushLocalResult`), never through a dialog.
import { useState } from 'react'
import type { Mission } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { hhmmss } from '../../shared/format/time'
import { planLibraryChanged } from '../assign/usePlanLibrary'
import { openMission } from '../plans/usePlanSet'
import { assign, forgetSaved } from '../plans/model'
import type { PlanSetStore } from '../plans/store'
import { localResultId } from '../vehicles/localResultId'
import type { VehicleStore } from '../vehicles/store'
import { createMission, deleteMission, downloadMission, exportWaypoints, getMission, importWaypoints, updateMission, uploadMission, uploadSavedMission, validateMission } from './api'
import { downloadText, parseRgcsMission, readFileText, safeFileStem, serializeRgcsMission } from './files'
import { toMission } from './model'
import { INITIAL_MISSION_UI, fresh as freshUi, loaded, markSaved, setBusy, setFindings, setReport, type MissionStore, type MissionUi } from './store'

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * File / saved / vehicle missions and 新しいプラン open as plans (a new row, or the untouched one),
 * so nothing in the editor is lost and no discard question is asked.
 */
/** `connected`: a mission saved for (or read from) a connected vehicle opens with it visibly assigned. */
export function useMissionIo(store: MissionStore, plans: PlanSetStore, sysid: number | null, dict: Dict, vehicles: VehicleStore, connected: (sysid: number) => boolean = () => false) {
  const [fitRequest, setFitRequest] = useState(0)
  const [picker, setPicker] = useState(false)
  const fit = () => setFitRequest((n) => n + 1)
  const result = (cmd: string, ok: boolean, reason: string | null, to: number | null = sysid) =>
    vehicles.pushLocalResult({ id: localResultId(), sysid: to ?? 0, cmd, ok, reason, ts: Date.now() })

  const open = (ui: MissionUi) => {
    openMission(plans, store, ui)
    fit()
  }
  const load = (m: Mission, id: number | null) => {
    open(loaded(INITIAL_MISSION_UI, m, id))
    // its own vehicle, when connected, becomes the shown target (both selects); never a hidden one
    const own = m.sysid
    // (not when another open mission already holds it: that row keeps its vehicle)
    if (own !== null && connected(own)) plans.update((w) => (w.rows.some((r) => r.key !== w.active && r.sysid === own) ? w : assign(w, w.active, own)))
  }

  const save = async (): Promise<number | null> => {
    const ui = store.getState()
    const mission = toMission(ui.history.present)
    store.update((u) => setBusy(u, 'saving'))
    try {
      const saved = ui.savedId === null ? await createMission(mission) : await updateMission(ui.savedId, mission)
      const id = saved.id ?? ui.savedId
      if (id !== null) store.update((u) => markSaved(u, id))
      planLibraryChanged()
      return id
    } catch (e) {
      result('mission_save', false, errText(e))
      return null
    } finally {
      store.update((u) => setBusy(u, 'idle'))
    }
  }

  /**
   * Validates and writes the plan to one vehicle; false when the validation stopped it. `keep`:
   * an earlier vehicle's fatal findings stay on screen instead of this one's. `savedId`: the plan
   * is saved and unchanged, so it goes through the saved upload and the server records it.
   */
  const uploadOne = async (to: number, mission: Mission, keep: boolean, savedId: number | null): Promise<boolean> => {
    try {
      const { findings } = await validateMission(mission, to)
      const fatal = findings.some((f) => f.level === 'fatal')
      if (fatal || !keep) store.update((u) => setFindings(u, findings))
      if (fatal) {
        result('mission_upload', false, dict.upFatal, to)
        return false
      }
      const report = savedId === null ? await uploadMission(to, mission) : await uploadSavedMission(to, savedId)
      store.update((u) => setReport(keep ? u : setFindings(u, report.findings), report))
      if (report.verified) vehicles.setVehicleMission(to, { ...mission, sysid: to })
      result('mission_upload', report.verified, report.verified ? `${report.items} ${dict.mItems}, ${dict.mVerified}` : `${dict.mMismatch}: ${report.mismatched.join(', ')}`, to)
    } catch (e) {
      result('mission_upload', false, errText(e), to)
    }
    return true
  }

  /** Writes the plan to `targets` (default: the mission's vehicle) one after another; a saved, clean plan by its id (the written plan is recorded). */
  const upload = async (targets: readonly number[] = sysid === null ? [] : [sysid]) => {
    if (targets.length === 0) return
    const ui = store.getState()
    const mission = toMission(ui.history.present)
    const savedId = ui.dirty ? null : ui.savedId
    store.update((u) => setBusy(u, 'uploading'))
    try {
      let stopped = false
      for (const to of targets) stopped = !(await uploadOne(to, mission, stopped, savedId)) || stopped
    } finally {
      store.update((u) => setBusy(u, 'idle'))
    }
  }

  /** Reads `from` (default: the target); the mission opens assigned to that vehicle. */
  const download = async (from: number | null = sysid) => {
    if (from === null) return
    store.update((u) => setBusy(u, 'downloading'))
    try {
      const m = await downloadMission(from)
      vehicles.setVehicleMission(from, m)
      // the editor being parked must not keep the 'downloading' state
      store.update((u) => setBusy(u, 'idle'))
      load({ ...m, sysid: from, name: m.name || `${dict.mDownloaded} ${hhmmss(Date.now())}` }, null)
      result('mission_download', true, `${m.items.length} ${dict.mItems}`, from)
    } catch (e) {
      result('mission_download', false, errText(e), from)
    } finally {
      store.update((u) => setBusy(u, 'idle'))
    }
  }

  const saveWaypointsFile = async () => {
    const ui = store.getState()
    const id = ui.dirty || ui.savedId === null ? await save() : ui.savedId
    if (id === null) return
    try {
      const text = await exportWaypoints(id)
      downloadText(`${safeFileStem(store.getState().history.present.mission.name)}.waypoints`, text, 'text/plain')
    } catch (e) {
      result('mission_export', false, errText(e))
    }
  }

  const saveRgcsFile = () => {
    const m = toMission(store.getState().history.present)
    downloadText(`${safeFileStem(m.name)}.rgcsmission`, serializeRgcsMission(m), 'application/json')
  }

  const loadFile = async (file: File) => {
    try {
      const text = await readFileText(file)
      const stem = file.name.replace(/\.[^.]+$/, '')
      const m = file.name.endsWith('.rgcsmission') ? parseRgcsMission(text) : await importWaypoints(text, stem)
      load({ ...m, name: m.name || stem }, null)
    } catch (e) {
      result('mission_import', false, `${file.name}: ${errText(e)}`)
    }
  }

  /** Each file opens its own row in the order picked; a bad one is reported and the rest go on. */
  const loadFiles = async (files: readonly File[]) => {
    for (const f of files) await loadFile(f)
  }

  const openSaved = async (id: number) => {
    setPicker(false)
    try {
      const m = await getMission(id)
      load(m, id)
    } catch (e) {
      result('mission_open', false, errText(e))
    }
  }

  /** Deletes a saved plan; its open rows stay as unsaved plans. True when the server deleted it. */
  const deleteSaved = async (id: number): Promise<boolean> => {
    try {
      await deleteMission(id)
    } catch (e) {
      result('mission_delete', false, errText(e))
      return false
    }
    plans.update((w) => forgetSaved(w, id))
    store.update((ui) => (ui.savedId === id ? { ...ui, savedId: null, dirty: true } : ui))
    planLibraryChanged()
    return true
  }

  return {
    fitRequest,
    picker,
    openPicker: () => setPicker(true),
    closePicker: () => setPicker(false),
    fresh: () => open(freshUi(INITIAL_MISSION_UI)),
    save,
    upload,
    download,
    saveWaypointsFile,
    saveRgcsFile,
    loadFile,
    loadFiles,
    openSaved,
    deleteSaved,
  }
}
