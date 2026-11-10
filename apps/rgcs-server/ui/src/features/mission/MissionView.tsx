import type { StyleSpecification } from 'maplibre-gl'
import type { DemEncoding } from '../map/terrain'
import { useMemo, useRef, useState } from 'react'
import type { Mission, MissionFrame, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { vehicleStore } from '../vehicles/store'
import { PlanList } from '../plans/PlanList'
import { planSetStore, type PlanSetStore } from '../plans/store'
import { usePlanSet } from '../plans/usePlanSet'
import { usePlanSetWrite } from '../plans/BatchWrite'
import { usePlanSetMap } from '../plans/usePlanSetMap'
import { AssignBoard } from '../assign/AssignBoard'
import { ModeSwitch } from '../assign/ModeSwitch'
import { useAssignMode } from '../assign/useAssignMode'
import { useAssignments } from '../assign/store'
import { pathModel, predictFor } from '../flightpath/predict'
import { vehicleParamNames } from '../survey/vehicleParams'
import { usePathParams } from '../flightpath/usePathParams'
import { CommandPalette } from './CommandPalette'
import { ContextMenu } from './ContextMenu'
import { MissionList } from './MissionList'
import { MissionListHeader } from './MissionListHeader'
import { SurveyFootToggle } from '../survey/SurveyFootToggle'
import { SurveySlot } from '../survey/SurveySlot'
import { SurveyNotice } from '../survey/SurveyNotice'
import { predictSurvey } from '../survey/surveyPredict'
import { insertAnchor, removeWithSurveys } from '../survey/draftOps'
import { ownsKey } from './editorKeys'
import { useSurveyWiring } from '../survey/useSurveyWiring'
import { UploadTargets } from './UploadTargets'
import { MapFinder } from './MapFinder'
import { placeTakeoffs, takeoffAnchor } from './geo'
import { MissionMap } from './MissionMap'
import { ElevationSheet } from './ElevationSheet'
import { HelpPanel } from './HelpPanel'
import { usePlanPanel } from './planPanel'
import { PlanRail } from './PlanRail'
import { usePlanEditor } from './planEditor'
import { FencePanel, PlanTabs, RallyPanel } from './PlanPanels'
import { FenceSidebar, RallySidebar } from './PlanSidebar'
import { removeRally, removeZone, setInclusion, setRadius, setRallyAlt } from './geofenceModel'
import { MissionPicker } from './MissionPicker'
import { MissionSidebar } from './MissionSidebar'
import { MissionHud } from './MissionHud'
import { canRedo, canUndo } from './history'
import type { ContextMenu as Menu } from './mapEdit'
import { useMissionIo } from './useMissionIo'
import { appendWaypoint, moveItemsTo, takeoffFor, clearItems, insertAfter, insertCommandAfter, moveItem, moveItems, reorder, reverseItems, setAltBulk, setArc, setCommand, setMeta, shiftAlts, updateItem, type Draft } from './model'
import { MissionStore, addToSelection, clearSelection, copySelected, dismissNotice, pasteClipboard, edit, missionStore, redoUi, removeSelected, selectOne, selectRange, setTool, undoUi, useMissionUi } from './store'
import { localWarnings, stats } from './summary'
import { BasemapPicker } from '../map/BasemapPicker'
import { LabelToggle } from './LabelToggle'
import { OverlayNotice } from '../overlays'
import { labelClasses, labelPrefsStore, useLabelPrefs, type LabelPrefsStore } from './labelPrefs'
import { MapModeToggle } from '../map/MapModeToggle'
import { saveMapMode, useMapMode } from '../map/mapMode'
import type { Basemap, MissionTransfer } from '../../shared/api/types'

interface Props {
  readonly vehicles: ReadonlyMap<number, VehicleState>
  /** Mission writes in progress (`mission_transfer`), per vehicle. */
  readonly transfers?: ReadonlyMap<number, MissionTransfer>
  readonly dict: Dict
  readonly style: StyleSpecification
  readonly basemap?: Basemap
  readonly basemaps?: readonly Basemap[]
  readonly onPickBasemap?: (id: string) => void
  /** DEM tiles; `null` / absent → 2D only. */
  readonly terrainTiles?: string | null
  readonly terrainEncoding?: DemEncoding
  readonly store?: MissionStore
  readonly plans?: PlanSetStore
  /** Which map labels show (tests pass their own store). */
  readonly labels?: LabelPrefsStore
  /** The vehicle selected in the ops list: 機体から読込 offers it when no target is chosen. */
  readonly opsSelected?: number | null
}

const NUDGE = 0.0001
const NO_TRANSFERS: ReadonlyMap<number, MissionTransfer> = new Map()

/** The mission planning screen (2D subset) built on the Glass prototype's layout. */
export function MissionView({ vehicles, transfers = NO_TRANSFERS, dict, style, basemap, basemaps = [], onPickBasemap, terrainTiles = null, terrainEncoding = 'terrarium', store = missionStore, plans = planSetStore, labels, opsSelected = null }: Props) {
  const mapMode = useMapMode()
  const is3d = mapMode === '3d' && terrainTiles !== null
  const ui = useMissionUi(store)
  const draft = ui.history.present
  const [fitTo, setFitTo] = useState<{ seq: number; points: readonly { lat: number; lon: number }[] } | null>(null)
  const onFit = (points: readonly { lat: number; lon: number }[]) => setFitTo((f) => ({ seq: (f?.seq ?? 0) + 1, points }))
  const openPlans = usePlanSet(plans, store, ui, onFit)
  const panel = usePlanPanel()
  const [menu, setMenu] = useState<Menu | null>(null)
  const [palette, setPalette] = useState(false)
  const [help, setHelp] = useState(false)
  const [targets, setTargets] = useState(false)
  const [focus, setFocus] = useState<{ lat: number; lon: number; seq: number } | null>(null)
  const plansMap = usePlanSetMap(openPlans.list.workspace)
  const board = useAssignMode(vehicles)
  const editing = !board.on
  const labelStore = labels ?? labelPrefsStore()
  const labelPrefs = useLabelPrefs(labelStore)
  const assignments = useAssignments()
  const [bulk, setBulk] = useState<{ alt: string; frame: MissionFrame }>({ alt: String(draft.mission.default_alt), frame: draft.mission.default_frame })
  const file = useRef<HTMLInputElement>(null)
  const list = [...vehicles.values()].sort((a, b) => a.sysid - b.sysid)
  const sysid = openPlans.target
  const online = list.filter((v) => v.link !== 'lost')
  const located = list.filter((v) => v.gps.fix >= 2 && !(v.lat === 0 && v.lon === 0))
  const vehicle = sysid === null ? null : (vehicles.get(sysid) ?? null)
  // the takeoff has no coordinates: drawn above the home
  const placed = useMemo(() => ({ ...draft, items: placeTakeoffs(draft.items, takeoffAnchor(draft.mission.home, vehicle)) }), [draft, vehicle])
  // A plane / QuadPlane / copter gets its expected flight drawn over the plan from its own parameters (2026-10-20).
  const kind = vehicle?.kind ?? null
  const pathValues = usePathParams(sysid, vehicleParamNames(kind))
  // telemetry replaces the home object every update: depend on its values, not its identity
  const [hLat, hLon, hAlt] = [vehicle?.home?.lat, vehicle?.home?.lon, vehicle?.home?.alt]
  const predict = useMemo(() => {
    const model = pathModel(kind, pathValues)
    // no vehicle: a plane survey is flown with its own speed, bank and WP radius
    if (!model) return kind === null ? predictSurvey : undefined
    const vHome = hLat !== undefined && hLon !== undefined && hAlt !== undefined ? { lat: hLat, lon: hLon, alt: hAlt } : null
    return (d: Draft) => predictFor(d, model, vHome)
  }, [kind, pathValues, hLat, hLon, hAlt])
  const change = (fn: (d: Draft) => Draft) => store.update((u) => edit(u, fn(u.history.present)))
  const takeoff = takeoffFor(vehicle?.kind ?? null, (pathValues.get('Q_ENABLE') ?? 0) >= 1)
  const isOnline = (s: number) => online.some((v) => v.sysid === s)
  const io = useMissionIo(store, plans, sysid, dict, vehicleStore, isOnline)
  const readFrom = sysid ?? (opsSelected !== null && isOnline(opsSelected) ? opsSelected : null)
  const saved = draft.mission.sysid
  const savedOffline = sysid === null && saved !== null && !isOnline(saved) ? dict.mSavedOffline.replace('{name}', vehicles.get(saved)?.name ?? `#${saved}`) : null
  const batch = usePlanSetWrite(openPlans.list.workspace, vehicles, dict)
  const fileHome = draft.mission.home ?? (vehicle?.home ? { lat: vehicle.home.lat, lon: vehicle.home.lon, alt: vehicle.home.alt } : null)
  const plan = usePlanEditor({ draft, sysid, dict, change, home: fileHome, onFit, store })
  const planIo = { sysid, targetName: vehicle?.name, busy: plan.busy, status: plan.status, dict, onWrite: plan.write, onRead: plan.read, onSaveFile: plan.saveFile, onLoadFile: (f: File) => void plan.loadFile(f), onCollapse: panel.collapse }
  const selectedItems = draft.items.filter((it) => ui.selected.has(it.uid))
  const lastSelected = selectedItems[selectedItems.length - 1]
  const sv = useSurveyWiring({ store, draft, change, afterUid: lastSelected?.uid ?? null, home: fileHome, kind, params: pathValues, tab: plan.tab, onFit, terrainTiles, terrainEncoding, predict })
  const st = stats(draft.items, draft.mission.home, draft.mission.speed)

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (board.on || ownsKey(e.target, e) || sv.onKey(e)) return
    const meta = e.metaKey || e.ctrlKey
    // fence / rally tabs: only undo / redo and finishing or cancelling a zone; waypoints stay put
    if (plan.tab !== 'mission' && !(meta && e.key.toLowerCase() === 'z')) {
      if (e.key !== 'Enter' && e.key !== 'Escape') return
      plan.finish()
      e.preventDefault()
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') store.update(removeSelected)
    else if (meta && e.key.toLowerCase() === 'z') store.update(e.shiftKey ? redoUi : undoUi)
    else if (meta && e.key.toLowerCase() === 'c' && ui.selected.size > 0) store.update(copySelected)
    else if (meta && e.key.toLowerCase() === 'v') store.update(pasteClipboard)
    else if (meta && e.key.toLowerCase() === 'a') store.update((u) => ({ ...u, selected: new Set(u.history.present.items.map((it) => it.uid)) }))
    else if (e.key === 'Escape') {
      store.update(clearSelection)
      setMenu(null)
      setPalette(false)
    } else if (e.key.startsWith('Arrow') && ui.selected.size > 0) {
      const step = NUDGE * (e.shiftKey ? 10 : 1)
      const d = e.key === 'ArrowUp' ? [step, 0] : e.key === 'ArrowDown' ? [-step, 0] : e.key === 'ArrowLeft' ? [0, -step] : [0, step]
      change((x) => moveItems(x, ui.selected, d[0]!, d[1]!))
    } else return
    e.preventDefault()
  }
  const applyBulk = () => {
    const alt = Number(bulk.alt)
    if (!Number.isNaN(alt)) change((d) => setAltBulk(d, ui.selected, alt, bulk.frame))
  }
  const insertFromPalette = (key: string) => {
    if (!sv.onPalette(key)) change((d) => insertCommandAfter(d, insertAnchor(d, lastSelected?.uid ?? null), key))
    setPalette(false)
  }

  return (
    <div className={`mission-view${editing ? (panel.collapsed ? ' panel-collapsed' : '') : ' assign-mode'}${labelClasses(labelPrefs)}`} style={{ position: 'absolute', inset: 0 }} tabIndex={-1} onKeyDown={onKeyDown} data-testid="mission-view">
      <MissionMap
        draft={sv.mapDraft}
        selected={ui.selected}
        tool={ui.tool}
        style={style}
        basemap={basemap}
        mode={mapMode}
        terrainTiles={terrainTiles}
        terrainEncoding={terrainEncoding}
        vehicle={vehicle}
        predict={predict}
        fitRequest={io.fitRequest}
        focus={focus}
        fitTo={fitTo}
        pathColor={openPlans.pathColor}
        panelCollapsed={panel.collapsed && editing}
        assign={board.assign}
        surveyDraw={sv.mapDraw}
        survey={sv.mapSurvey}
        onAdd={(lat, lon) => change((d) => appendWaypoint(d, lat, lon, { takeoff }))}
        onInsertAfter={(uid, lat, lon) => change((d) => insertAfter(d, uid, lat, lon))}
        onMove={(uid, lat, lon) => change((d) => moveItem(d, uid, lat, lon))}
        onMoveSelected={(dLat, dLon) => change((d) => moveItems(d, ui.selected, dLat, dLon))}
        onShiftAlt={(uids, dAlt) => change((d) => shiftAlts(d, uids, dAlt))}
        onBoxSelect={(uids) => store.update((u) => addToSelection(u, uids))}
        onArc={(uid, angle) => change((d) => setArc(d, uid, angle))}
        tab={plan.tab}
        onPlanClick={plan.onPlanClick}
        onFenceEdit={plan.onFenceEdit}
        onRallyMove={plan.onRallyMove}
        ceiling={plan.fenceParams?.alt_max ?? null}
        onSelect={(uid, additive, range) => store.update((u) => (range ? selectRange(u, uid) : selectOne(u, uid, additive)))}
        onBackgroundClick={() => store.update(clearSelection)}
        onContext={setMenu}
        {...plansMap}
      />
      <div className="g-ctl float map-l top1 compass" aria-hidden="true" style={{ transform: is3d ? 'rotate(25deg)' : undefined }}>
        <span>N</span>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M12 3l6 16-6-4-6 4z" />
        </svg>
      </div>
      <MapFinder vehicles={located} dict={dict} onGo={(to) => setFocus((f) => ({ ...to, seq: (f?.seq ?? 0) + 1 }))} />
      {basemap && onPickBasemap && <BasemapPicker basemaps={basemaps} current={basemap.id} dict={dict} onPick={onPickBasemap} className="float map-r top2" overlays="plan" />}
      <OverlayNotice dict={dict} />
      {editing && <LabelToggle prefs={labelPrefs} dict={dict} onToggle={(k) => labelStore.toggle(k)} className={`float map-r ${basemap && onPickBasemap ? 'top3' : 'top2'}`} />}
      <MapModeToggle mode={mapMode} available={terrainTiles !== null} dict={dict} onChange={saveMapMode} />
      {ui.busy === 'idle' && <ModeSwitch on={board.on} dict={dict} onChange={board.setOn} />}
      {editing && <PlanTabs tab={plan.tab} dict={dict} onChange={plan.setTab} />}
      {board.on && <AssignBoard vehicles={list} openRows={openPlans.list.workspace.rows} dict={dict} onOverlay={board.onOverlay} onFit={onFit} onWrite={batch.open} />}
      {editing && <ElevationSheet draft={placed} selected={ui.selected} terrainTiles={terrainTiles} terrainEncoding={terrainEncoding} ceiling={plan.fenceParams?.alt_max ?? null} dict={dict} onSelect={(uid, additive, range) => store.update((u) => (range ? selectRange(u, uid) : selectOne(u, uid, additive)))} />}
      <button type="button" className={`g-ctl ctl float map-r2 top1 help-btn${help ? ' on' : ''}`} title={dict.mHelpTitle} aria-label={dict.mHelpTitle} onClick={() => setHelp((h) => !h)}>
        ?
      </button>
      {help && <HelpPanel dict={dict} onClose={() => setHelp(false)} />}
      {editing && <SurveyFootToggle {...sv.footButton} dict={dict} />}
      {/* one summary at a time: the HUD only while the right summary is folded away */}
      {editing && (panel.collapsed || plan.tab !== 'mission') && <MissionHud stats={st} kind={kind} dict={dict} />}

      {editing && plan.tab === 'fence' && (
        <FencePanel
          zones={draft.mission.fence}
          armed={plan.armed}
          drawing={plan.drawing}
          dict={dict}
          onArm={plan.arm}
          onDone={plan.finish}
          onRadius={(zi, r) => change((d) => setRadius(d, zi, r))}
          onInclusion={(zi, inc) => change((d) => setInclusion(d, zi, inc))}
          onRemove={(zi) => change((d) => removeZone(d, zi))}
        />
      )}
      {editing && plan.tab === 'rally' && (
        <RallyPanel
          points={draft.mission.rally}
          dict={dict}
          onAlt={(i, alt) => change((d) => setRallyAlt(d, i, alt))}
          onRemove={(i) => change((d) => removeRally(d, i))}
        />
      )}
      {editing && plan.tab === 'mission' && (
        <aside className="g panel float float-l mission-left" aria-label={dict.navMission}>
          <PlanList {...openPlans.list} liveDirty={ui.dirty} busy={ui.busy !== 'idle'} vehicles={list} assignments={assignments} dict={dict} onOpenBoard={() => board.setOn(true)} />
          <MissionListHeader count={draft.items.length} dict={dict} canUndo={canUndo(ui.history)} canRedo={canRedo(ui.history)} onUndo={() => store.update(undoUi)} onRedo={() => store.update(redoUi)} onReverse={() => change(reverseItems)} onClear={() => change(clearItems)} />
          <div className="hair mission-tools">
            <div className="seg" style={{ height: 36 }} role="group" aria-label="tool">
              <span className="lens" style={{ transform: `translateX(${ui.tool === 'add' ? 0 : 100}%)` }} />
              <button type="button" className={ui.tool === 'add' ? 'on' : ''} onClick={() => store.update((u) => setTool(u, 'add'))}>
                {dict.mToolAdd}
              </button>
              <button type="button" className={ui.tool === 'select' ? 'on' : ''} onClick={() => store.update((u) => setTool(u, 'select'))}>
                {dict.mToolSelect}
              </button>
            </div>
            <button type="button" className={`btn${palette ? ' on' : ''}`} style={{ height: 36, padding: '0 12px 0 10px', gap: 6 }} onClick={() => setPalette((p) => !p)}>
              <span style={{ fontSize: 17, lineHeight: 1, fontWeight: 300 }}>+</span>
              {dict.mInsertCmd}
            </button>
          </div>
          <SurveySlot {...sv.slot} dict={dict} />
          <SurveyNotice names={ui.surveyNotice} dict={dict} onUndo={() => store.update(undoUi)} onClose={() => store.update(dismissNotice)} />
          <div className="wp-scroll">
            <MissionList
              items={draft.items}
              surveys={draft.surveys}
              home={fileHome}
              selected={ui.selected}
              kind={vehicle?.kind ?? null}
              dict={dict}
              onSelect={(uid, additive, range) => store.update((u) => (range ? selectRange(u, uid) : selectOne(u, uid, additive)))}
              onReorder={(uid, dir) => change((d) => reorder(d, uid, dir))}
              onMove={(uids, before) => change((d) => moveItemsTo(d, uids, before))}
              onContext={(uid, x, y) => {
                store.update((u) => (u.selected.has(uid) ? u : selectOne(u, uid, false)))
                setMenu({ uid, x, y })
              }}
            />
          </div>
          <div className="hair-t" style={{ display: 'grid', gap: 8, padding: '10px 12px 12px' }}>
            <button type="button" className="btn" onClick={() => file.current?.click()}>
              {dict.mFileLoad}
            </button>
            <input
              ref={file}
              type="file"
              accept=".waypoints,.rgcsmission,.txt,text/plain,application/json"
              multiple
              style={{ display: 'none' }}
              data-testid="mission-file"
              onChange={(e) => {
                void io.loadFiles([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
          </div>
          {palette && (
            <CommandPalette
              kind={kind}
              vtol={vehicle?.vtol === true || (pathValues.get('Q_ENABLE') ?? 0) >= 1}
              where={lastSelected ? `#${draft.items.indexOf(lastSelected) + 1} ${dict.mInsertAt}` : dict.mInsertEnd}
              dict={dict}
              onInsert={insertFromPalette}
              onClose={() => setPalette(false)}
            />
          )}
        </aside>
      )}

      {editing && panel.collapsed && <PlanRail dict={dict} onExpand={panel.expand} />}
      {editing && !panel.collapsed && plan.tab === 'fence' && (
        <FenceSidebar
          zones={draft.mission.fence}
          fenceParams={plan.fenceParams}
          onAltMax={plan.setAltMax}
          {...planIo}
        />
      )}
      {editing && !panel.collapsed && plan.tab === 'rally' && <RallySidebar points={draft.mission.rally} {...planIo} />}
      {editing && !panel.collapsed && plan.tab === 'mission' && (
      <MissionSidebar
        transfer={sysid === null ? null : (transfers.get(sysid) ?? null)}
        draft={draft}
        selectedItems={selectedItems}
        vehicles={list}
        sysid={sysid}
        kind={vehicle?.kind ?? null}
        stats={st}
        warnings={localWarnings(draft.items, draft.mission.speed, vehicle?.kind ?? null)}
        findings={ui.findings}
        dirty={ui.dirty}
        busy={ui.busy !== 'idle'}
        dict={dict}
        bulk={bulk}
        onBulk={setBulk}
        onApplyBulk={applyBulk}
        onDeselect={() => store.update(clearSelection)}
        onDeleteSelected={() => store.update(removeSelected)}
        multi={openPlans.multi}
        onMeta={(patch) => {
          const own = openPlans.metaPatch(patch)
          change((d) => setMeta(d, own))
        }}
        onItemChange={(uid, patch) => change((d) => updateItem(d, uid, patch))}
        onItemCommand={(uid, key) => change((d) => setCommand(d, uid, key))}
        takeoff={takeoff}
        onFix={change}
        onNew={io.fresh}
        onOpen={io.openPicker}
        onSave={() => void io.save()}
        onRead={() => void io.download(readFrom)}
        canRead={ui.busy === 'idle' && readFrom !== null}
        readLabel={sysid === null && readFrom !== null ? dict.mReadFrom.replace('{name}', vehicles.get(readFrom)?.name ?? `#${readFrom}`) : dict.mRead}
        targetHint={savedOffline}
        onUpload={() => (online.length > 1 && !openPlans.multi ? setTargets(true) : void io.upload())}
        onSaveFile={() => void io.saveWaypointsFile()}
        onSaveRgcs={io.saveRgcsFile}
        compare={batch.compare}
        survey={sv.editor}
        onCollapse={panel.collapse}
      />
      )}

      {targets && (
        <UploadTargets
          vehicles={online}
          target={sysid}
          dict={dict}
          onClose={() => setTargets(false)}
          onWrite={(ids) => {
            setTargets(false)
            void io.upload(ids)
          }}
        />
      )}
      {batch.sheet}
      {io.picker && <MissionPicker dict={dict} title={dict.mSaved} onClose={io.closePicker} onPick={(row) => void io.openSaved(row.id)} onDelete={(row) => io.deleteSaved(row.id)} />}
      {menu && (
        <ContextMenu
          menu={menu}
          dict={dict}
          onInsert={(uid) => {
            const at = insertAnchor(draft, uid)!
            const it = draft.items.find((x) => x.uid === at)
            if (it) change((d) => insertAfter(d, at, it.lat + 0.0005, it.lon + 0.0005))
          }}
          onDelete={(uid) => change((d) => removeWithSurveys(d, new Set([uid])))}
          onBulkAlt={() => {
            store.update((u) => (u.selected.has(menu.uid) ? u : selectOne(u, menu.uid, false)))
            setBulk({ alt: String(draft.mission.default_alt), frame: draft.mission.default_frame })
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

export type { Mission }
