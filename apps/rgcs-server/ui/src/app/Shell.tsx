import { useEffect, useMemo, useRef, useState } from 'react'
import { authStore } from '../features/auth/store'
import { CommandDock, ConfirmDialog, FleetConfirm, fleetSkipped, fleetTargets, type Skipped, localResult, useCommandRunner, type RunResult } from '../features/commands'
import { EMPTY_PENDING, cameraErrorText, clearPending, markPending, sendCameraCommand, type PendingState } from '../features/camera'
import { CameraSettingsSheet } from '../features/camera-settings'
import { PresentSettings } from '../features/present-settings'
import { GuardBanner, GuardSettingsSheet, cancelGuardAlert, guardedVehicles, useGuardAlerts, useGuardEnabled, webAudioTone } from '../features/guard'
import { EnvSourcesSheet, EnvSummaryChip, useEnvSummary } from '../features/env'
import { DetailPanel, ackMessage } from '../features/detail'
import { AiPanel, useAiChat } from '../features/ai'
import { buttonAction, getGimbalProfile, releaseCommand, useGimbalJoystick } from '../features/gimbal-joystick'
import { GuidedModal } from '../features/guided'
import { MissionWriteSheet, MissionView, getKnownMission, getMission, uploadSavedMission } from '../features/mission'
import { useOpsArrival } from './opsArrival'
import { MaintView } from '../features/params'
import { NetworkView } from '../features/network'
import { BasemapPicker, ShowAllButton, FollowChip, MapContextMenu, MapModeToggle, MapView, type MapPoint, saveMapMode, useMapMode, basemapStyle, cancelPick, chooseBasemap, saveBasemapChoice, useBasemapChoice, vehicleHomes, clearFollow, mapUiStore, padding, rasterStyle, requestFocus, setFollow, setTarget, startPick, toggleAside, tracksStore, useMapUi, useTracks, NO_PADDING, WpGoPopover, type WaypointPick } from '../features/map'
import { OverlayNotice } from '../features/overlays'
import { useVehicles, vehicleStore } from '../features/vehicles/store'
import { VehicleList } from '../features/vehicles/VehicleList'
import { useAppSettings } from '../shared/api/settings'
import type { CameraCommand, GimbalInputProfile, Me, VehicleCommand, VehicleState } from '../shared/api/types'
import { t, type Lang } from '../shared/i18n'
import { LogDock } from './LogDock'
import { useLogHistory } from '../features/log/useLogHistory'
import { usePredicted } from '../features/flightpath/usePredicted'
import { VideoStage } from '../features/video'
import { Header } from './Header'
import { NO_MODAL, type Modal } from './modal'
import { useCalibAttention } from '../features/calibration'
import { panelSysid, togglePin } from './pin'
import { useCameraSettingsFlow } from './useCameraSettingsFlow'
import { roiStart, roiStop, runButtonAction, useActiveRoiName } from './roiActions'
import { usePlace } from './usePlace'
import { executeProposal } from './aiExecute'

function formatClock(d: Date, lang: Lang): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const wd = t(lang).weekdays.split(',')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} (${wd[d.getDay()]}) ${p(d.getHours())}:${p(d.getMinutes())}`
}

function useClock(lang: Lang): string {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return formatClock(now, lang)
}

interface Props {
  readonly me: Me
  readonly lang: Lang
}

/** The signed-in application: header, stage with floating panels, footer. */
export function Shell({ me, lang }: Props) {
  const dict = t(lang)
  const { vehicles: liveVehicles, link, log, cameras, videoSources, roi, deadman, missionProgress, missionTransfers, vehicleMissions, paramProgress, flightDrafts, logFetch, calibration, network } = useVehicles()
  // AI 緊急介入: a vehicle with an active alert gets the warn visual on the map marker and the list dot
  const guard = useGuardAlerts()
  const vehicles = useMemo(() => guardedVehicles(liveVehicles, guard.active), [liveVehicles, guard.active])
  const tone = useMemo(() => webAudioTone(), [])
  const envSummary = useEnvSummary()
  const [pending, setPending] = useState<PendingState>(EMPTY_PENDING)
  const [gimbalProfile, setGimbalProfile] = useState<GimbalInputProfile | null>(null)
  useEffect(() => {
    let alive = true
    getGimbalProfile()
      .then((p) => alive && setGimbalProfile(p))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  const [selected, setSelected] = useState<number | null>(null)
  // 詳細パネルのピン: the panel stays on this vehicle while the selection moves
  const [pinned, setPinned] = useState<number | null>(null)
  const { view, setView, navView, nav, aiOpen, closeAi } = usePlace()
  const chat = useAiChat()
  const arrival = useOpsArrival(view)
  // 全機体映像: the vehicle in the camera cockpit (null = the grid)
  const [maxVideo, setMaxVideo] = useState<number | null>(null)
  const [modal, setModal] = useState<Modal>(NO_MODAL)
  // re-read after the 実験機能 sheet (any modal) closes; off means no 外的要因 chip
  const guardOn = useGuardEnabled(modal.kind)
  // The command panel is a tool, not a dialog: open until closed, across commands and selections.
  const [commandsOpen, setCommandsOpen] = useState(false)
  // Fleet command being confirmed, with its targets fixed when the dialog opened.
  const [mapMenu, setMapMenu] = useState<MapPoint | null>(null)
  // 「このWPへ行く」: the mission badge clicked on the operations map
  const [wpGo, setWpGo] = useState<WaypointPick | null>(null)
  useEffect(() => setWpGo(null), [view])
  // 「全機を表示」: each press frames the fleet once
  const [showAll, setShowAll] = useState(0)
  const [fleet, setFleet] = useState<{ command: VehicleCommand; targets: VehicleState[]; skipped: Skipped[] } | null>(null)
  const runner = useCommandRunner({
    entries: log.entries,
    dict,
    vehicleOf: (sysid) => vehicles.get(sysid),
    onError: (sysid, command, message) => vehicleStore.pushLocalResult(localResult(sysid, command, message)),
  })
  const tracks = useTracks()
  const mapUi = useMapUi()
  const settings = useAppSettings()
  const basemapId = useBasemapChoice()
  const mapMode = useMapMode()
  const basemap = settings && settings.basemaps.length > 0 ? chooseBasemap(settings.basemaps, basemapId) : null
  const clock = useClock(lang)
  useEffect(() => vehicleStore.subscribe(() => tracksStore.ingest(vehicleStore.getState().vehicles)), [])
  const trackMinutes = settings?.map.track_minutes
  useEffect(() => {
    if (trackMinutes !== undefined) tracksStore.setKeepMinutes(trackMinutes)
  }, [trackMinutes])
  const list = [...vehicles.values()].sort((a, b) => a.sysid - b.sysid)
  const names = new Map(list.map((v) => [v.sysid, v.name]))
  const homes = useMemo(() => vehicleHomes(vehicles, vehicleMissions), [vehicles, vehicleMissions])
  useLogHistory(link)
  const current = selected ?? list[0]?.sysid ?? null
  const currentMission = current === null ? null : (vehicleMissions.get(current) ?? null)
  const predicted = usePredicted(currentMission, current === null ? null : (vehicles.get(current) ?? null))
  const currentVehicle = current === null ? undefined : vehicles.get(current)
  const panel = panelSysid(pinned, selected, (sysid) => vehicles.has(sysid))
  const detail = panel === null ? undefined : vehicles.get(panel)
  // the command dock acts on the vehicle the panel shows (a pinned panel may differ from the selection)
  const dockVehicle = detail ?? currentVehicle
  const maintAttention = useCalibAttention(detail?.sysid ?? null, detail ? calibration.get(detail.sysid)?.phase : undefined)
  // The maintenance and video views take the map's place; the right panel belongs to the operations map.
  const showDetail = detail !== undefined && view !== 'maint' && view !== 'video' && !aiOpen
  const showRight = showDetail || aiOpen
  const openCockpit = (sysid: number) => {
    setSelected(sysid)
    setMaxVideo(sysid)
    setView('video')
  }
  const cameraCommand = (sysid: number, cmd: CameraCommand) => {
    setPending((p) => markPending(p, sysid, cmd.cmd, Date.now()))
    sendCameraCommand(sysid, cmd).catch((e: unknown) => {
      setPending((p) => clearPending(p, sysid))
      vehicleStore.pushLocalResult({ id: -Date.now(), sysid, cmd: `camera:${cmd.cmd}`, ok: false, reason: cameraErrorText(e, dict), ts: Date.now() })
    })
  }
  const focusVehicle = (sysid: number) => {
    setSelected(sysid)
    setView('ops')
    mapUiStore.update((s) => requestFocus(s, sysid))
  }
  const cancelAlert = (id: string) =>
    cancelGuardAlert(id).catch((e: unknown) => {
      const sysid = guard.alerts.get(id)?.sysid ?? 0
      vehicleStore.pushLocalResult({ id: -Date.now(), sysid, cmd: 'guard_cancel', ok: false, reason: `${dict.gaCancelFailed}: ${e instanceof Error ? e.message : String(e)}`, ts: Date.now() })
      throw e
    })
  const logDock = <LogDock log={log} names={names} dict={dict} clock="" lead={view !== 'maint'} deadmanLost={deadman === 'lost'} onFocusVehicle={focusVehicle} />
  const ackAlert = (sysid: number, id: number) => {
    ackMessage(sysid, id)
      .then((e) => vehicleStore.markAcked(e.id, e.acked_by ?? me.username, e.acked_at ?? Date.now()))
      .catch((e: unknown) => {
        vehicleStore.pushLocalResult({ id: -Date.now(), sysid, cmd: 'message_ack', ok: false, reason: e instanceof Error ? e.message : String(e), ts: Date.now() })
      })
  }
  const lastCameras = useRef(cameras)
  useEffect(
    () =>
      vehicleStore.subscribe(() => {
        // A fresh camera_state (the server re-sends at least every second) settles pending commands.
        const next = vehicleStore.getState().cameras
        if (next === lastCameras.current) return
        lastCameras.current = next
        setPending((p) => [...next.keys()].reduce((acc, sysid) => clearPending(acc, sysid), p))
      }),
    [],
  )
  const settingsFlow = useCameraSettingsFlow({ modal, setModal, terrainTiles: settings?.terrain_tiles ?? null, terrainEncoding: settings?.terrain_encoding === 'mapbox' ? 'mapbox' : 'terrarium', vehicles, setGimbalProfile, dict })
  useGimbalJoystick(
    current,
    gimbalProfile,
    (fn) => {
      if (current === null) return
      runButtonAction(current, buttonAction(fn, cameras.get(current)?.state ?? null, roi.get(current)?.active_target ?? null), cameraCommand)
    },
    // The release goes where the press went, even if the selection changed meanwhile.
    (fn, sysid) => {
      const cmd = releaseCommand(fn)
      if (cmd) cameraCommand(sysid, cmd)
    },
  )
  const detailRoiName = useActiveRoiName(detail?.sysid ?? null, roi)

  // A reloaded page (or a second laptop) learns the vehicle's mission from the server.
  const knownMissing = current !== null && !vehicleMissions.has(current)
  useEffect(() => {
    if (current === null || !knownMissing) return
    let alive = true
    getKnownMission(current)
      .then((m) => alive && m && vehicleStore.setVehicleMission(current, m))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [current, knownMissing])

  const writeSavedMission = async (sysid: number, id: number) => {
    setModal(NO_MODAL)
    try {
      const report = await uploadSavedMission(sysid, id)
      if (report.verified) vehicleStore.setVehicleMission(sysid, { ...(await getMission(id)), sysid })
      vehicleStore.pushLocalResult({
        id: -Date.now(),
        sysid,
        cmd: 'mission_upload',
        ok: report.verified,
        reason: report.verified ? `${report.items} ${dict.mItems}, ${dict.mVerified}` : `${dict.mMismatch}: ${report.mismatched.join(', ')}`,
        ts: Date.now(),
      })
    } catch (e: unknown) {
      vehicleStore.pushLocalResult({ id: -Date.now(), sysid, cmd: 'mission_upload', ok: false, reason: e instanceof Error ? e.message : String(e), ts: Date.now() })
    }
  }

  const settle = (sysid: number, result: RunResult, command: VehicleCommand) => {
    if (result.kind === 'needs_confirm') return setModal({ kind: 'confirm', sysid, command, message: result.message })
    if (result.kind === 'error') {
      vehicleStore.pushLocalResult(localResult(sysid, command, result.message))
    }
    setModal(NO_MODAL)
  }
  return (
    <div className="shell">
      <div className="frame">
        <Header
          vehicles={list}
          link={link}
          dict={dict}
          clock={clock}
          me={me}
          view={navView}
          onView={nav}
          onLogout={() => void authStore.logout()}
          onPresent={() => setModal({ kind: 'present-settings' })}
        />
        {view === 'mission' && settings && (
          <main className="stage mission" style={{ position: 'absolute', inset: 0 }}>
            <MissionView
              vehicles={vehicles}
              transfers={missionTransfers}
              dict={dict}
              style={basemap ? basemapStyle(basemap) : rasterStyle(settings.map_tile_url, settings.map_attribution)}
              basemap={basemap ?? undefined}
              basemaps={settings.basemaps}
              onPickBasemap={saveBasemapChoice}
              terrainTiles={settings.terrain_tiles}
              terrainEncoding={settings.terrain_encoding === 'mapbox' ? 'mapbox' : 'terrarium'}
              opsSelected={selected}
            />
            {logDock}
          </main>
        )}
        {view === 'network' && (
          <main className="stage net" style={{ position: 'absolute', inset: 0 }}>
            <NetworkView ws={network} dict={dict} />
            {logDock}
          </main>
        )}
        <main className={`stage${showRight ? '' : ' noright'}${mapUi.aside === 'rail' ? ' rail' : ''}${view === 'maint' ? ' maint-on' : ''}${view === 'video' ? ' video-on' : ''}`} style={{ position: 'absolute', inset: 0, display: view === 'mission' || view === 'network' ? 'none' : undefined }}>
          {settings && (
            <MapView
              vehicles={vehicles}
              tracks={tracks}
              follow={mapUi.follow}
              selected={current}
              padding={padding(mapUi.aside, detail !== undefined || aiOpen)}
              style={basemap ? basemapStyle(basemap) : rasterStyle(settings.map_tile_url, settings.map_attribution)}
              basemap={basemap ?? undefined}
              mode={mapMode}
              terrainTiles={settings.terrain_tiles}
              terrainEncoding={settings.terrain_encoding === 'mapbox' ? 'mapbox' : 'terrarium'}
              target={mapUi.target}
              focus={mapUi.focus}
              arrival={arrival}
              showAll={showAll}
              homeTitle={(sysid) => dict.homeOf.replace('{name}', names.get(sysid) ?? `#${sysid}`)}
              mission={currentMission}
              predicted={predicted}
              missionCurrent={current === null ? null : (missionProgress.get(current)?.seq ?? null)}
              homes={homes}
              cameras={cameras}
              roi={roi}
              groundProjection={settings.map.gimbal_ground_projection}
              onDragStart={() => mapUiStore.update(clearFollow)}
              onClick={(p) => (mapUi.pick === 'roi-target' ? void settingsFlow.onMapPick(p) : mapUi.pick === 'guided-target' && mapUiStore.update((s) => setTarget(s, p)))}
              onContext={view === 'ops' ? setMapMenu : undefined}
              onWaypoint={setWpGo}
              onViewMove={() => setWpGo(null)}
            />
          )}
          {view === 'ops' && settings && <MapModeToggle mode={mapMode} available={settings.terrain_tiles !== null} dict={dict} onChange={saveMapMode} />}
          {view === 'ops' && settings && guardOn && <EnvSummaryChip summary={envSummary} dict={dict} now={Date.now()} />}
          {view === 'ops' && settings && basemap && <BasemapPicker basemaps={settings.basemaps} current={basemap.id} dict={dict} onPick={saveBasemapChoice} className="float map-r top2" overlays="ops" />}
          {view === 'ops' && settings && <OverlayNotice dict={dict} />}
          {view === 'ops' && settings && (
            <ShowAllButton
              dict={dict}
              className={`float map-r ${basemap && settings.basemaps.length > 1 ? 'top3' : 'top2'}`}
              onClick={() => {
                mapUiStore.update(clearFollow)
                setShowAll((n) => n + 1)
              }}
            />
          )}
          {view === 'maint' && (
            <>
              <div className="maint-backdrop" />
              <MaintView vehicles={vehicles} paramProgress={paramProgress} dict={dict} selected={current} me={me} flightDrafts={flightDrafts} logFetch={logFetch} calibration={calibration} onOpenPresent={() => setModal({ kind: 'present-settings' })} onOpenGuard={() => setModal({ kind: 'guard-settings' })} onOpenEnv={() => setModal({ kind: 'env-sources' })} />
            </>
          )}
          {view === 'video' && settings && (
            <VideoStage
              vehicles={list}
              cameras={cameras}
              videoSources={videoSources}
              pending={new Set(pending.bySysid.keys())}
              selected={current}
              maximized={maxVideo}
              dict={dict}
              onSelect={setSelected}
              onMaximize={openCockpit}
              onRestore={() => setMaxVideo(null)}
              onCommand={cameraCommand}
              onSettings={(sysid) => setModal({ kind: 'camera-settings', sysid })}
              roi={roi}
              onRoiStart={roiStart}
              onRoiStop={roiStop}
              miniMap={
                maxVideo !== null && (
                  <MapView vehicles={vehicles} tracks={tracks} follow={maxVideo} selected={maxVideo} padding={NO_PADDING} style={basemap ? basemapStyle(basemap) : rasterStyle(settings.map_tile_url, settings.map_attribution)} basemap={basemap ?? undefined} homes={homes} cameras={cameras} roi={roi} target={null} onDragStart={() => {}} onClick={() => {}} />
                )
              }
            />
          )}
          {view !== 'video' && (
          <VehicleList
            vehicles={list}
            selected={current}
            dict={dict}
            aside={mapUi.aside}
            onToggleAside={() => mapUiStore.update(toggleAside)}
            onSelect={setSelected}
            onFollow={(sysid) => mapUiStore.update((s) => (s.follow === sysid ? clearFollow(s) : setFollow(s, sysid)))}
            following={mapUi.follow}
            onFleet={view === 'ops' ? (command) => setFleet({ command, targets: fleetTargets(list), skipped: fleetSkipped(list) }) : undefined}
            guarded={guard.active}
          />
          )}
          {mapUi.follow !== null && view === 'ops' && (
            <FollowChip name={vehicles.get(mapUi.follow)?.name ?? `#${mapUi.follow}`} dict={dict} onClear={() => mapUiStore.update(clearFollow)} />
          )}
          {detail && showDetail && (
            <DetailPanel
              vehicle={detail}
              entries={log.entries}
              dict={dict}
              onAck={ackAlert}
              onOpenLog={(sysid) => vehicleStore.logAction({ k: 'open', filter: sysid })}
              onClose={() => {
                setPinned(null)
                setSelected(null)
              }}
              pinned={pinned === detail.sysid}
              onTogglePin={(sysid) => setPinned((p) => togglePin(p, sysid))}
              onOpenMaint={(sysid) => {
                setSelected(sysid)
                setView('maint')
              }}
              maintAttention={maintAttention}
              onOpenCommands={() => setCommandsOpen((o) => !o)}
              camera={cameras.get(detail.sysid)}
              videoSource={videoSources.get(detail.sysid)}
              cameraPending={pending.bySysid.has(detail.sysid)}
              onCameraCommand={(cmd) => cameraCommand(detail.sysid, cmd)}
              onCameraSettings={() => setModal({ kind: 'camera-settings', sysid: detail.sysid })}
              roiName={detailRoiName}
              onMaximize={openCockpit}
              vehicleMission={vehicleMissions.get(detail.sysid)}
              missionProgress={missionProgress.get(detail.sysid)}
              missionTransfer={missionTransfers.get(detail.sysid)}
              onWriteMission={() => setModal({ kind: 'mission-pick', sysid: detail.sysid })}
              onStartMission={(restart) => setModal({ kind: 'confirm', sysid: detail.sysid, command: { cmd: 'mission_start' }, message: restart ? dict.mRestartNote : undefined })}
              commandsOpen={commandsOpen}
              onCommand={(command) => runner.pick(detail.sysid, command)}
              feedback={(cmd) => runner.feedback(detail.sysid, cmd)}
            />
          )}
          {aiOpen && (
            <AiPanel vehicles={list} target={current} onTarget={setSelected} chat={chat} dict={dict} onExecute={executeProposal(chat, runner, dict)} onClose={closeAi} />
          )}
          {commandsOpen && view === 'ops' && dockVehicle && (
            <CommandDock
              vehicle={dockVehicle}
              entries={log.entries}
              dict={dict}
              beside={detail !== undefined || aiOpen}
              onClose={() => setCommandsOpen(false)}
              onOpenGuided={(sysid) => setModal({ kind: 'guided', sysid })}
              onOpenCamera={(sysid) => setModal({ kind: 'camera-settings', sysid })}
              runner={runner}
            />
          )}
          {runner.confirm}
          {mapMenu && view === 'ops' && (
            <MapContextMenu
              at={mapMenu}
              vehicleName={currentVehicle?.name ?? null}
              dict={dict}
              onClose={() => setMapMenu(null)}
              onGuided={(p) => {
                if (!currentVehicle) return
                mapUiStore.update((s) => setTarget(s, p))
                setModal({ kind: 'guided', sysid: currentVehicle.sysid })
              }}
            />
          )}
          {wpGo && view === 'ops' && (
            <WpGoPopover at={wpGo} vehicle={vehicles.get(wpGo.sysid)} dict={dict} onSend={runner.pick} onClose={() => setWpGo(null)} />
          )}
          {fleet && (
            <FleetConfirm
              command={fleet.command}
              targets={fleet.targets}
              skipped={fleet.skipped}
              dict={dict}
              onClose={() => setFleet(null)}
              onResult={(sysid, ok, reason) => !ok && vehicleStore.pushLocalResult({ id: -Date.now() - sysid, sysid, cmd: fleet.command.cmd, ok, reason: reason ?? null, ts: Date.now() })}
            />
          )}
          {modal.kind === 'guided' && currentVehicle && (
            <GuidedModal
              // a new target vehicle starts a fresh flow (no altitude / step carried over)
              key={currentVehicle.sysid}
              vehicle={currentVehicle}
              target={mapUi.target}
              dict={dict}
              onPickTarget={() => mapUiStore.update((s) => startPick(s, 'guided-target'))}
              onClose={() => {
                mapUiStore.update(cancelPick)
                setModal(NO_MODAL)
              }}
              onDone={(outcome) => {
                if (outcome.kind === 'error') {
                  vehicleStore.pushLocalResult({ id: -Date.now(), sysid: currentVehicle.sysid, cmd: 'guided', ok: false, reason: outcome.message, ts: Date.now() })
                }
                setModal(NO_MODAL)
              }}
            />
          )}
          {modal.kind === 'camera-settings' && settingsFlow.profile && gimbalProfile && (
            <CameraSettingsSheet
              sysid={modal.sysid}
              profile={settingsFlow.profile}
              inputProfile={gimbalProfile}
              cameraState={cameras.get(modal.sysid)?.state}
              caps={cameras.get(modal.sysid)?.caps}
              gamepadIds={typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? navigator.getGamepads().flatMap((g) => (g ? [g.id] : [])) : []}
              roiSupported={(cameras.get(modal.sysid)?.caps.roi ?? 'none') !== 'none'}
              roi={settingsFlow.roi}
              activeRoi={roi.get(modal.sysid)?.active_target ?? null}
              initial={settingsFlow.draft ?? undefined}
              notice={settingsFlow.elevationFallback ? dict.roiNoElevation : null}
              dict={dict}
              onCancel={() => setModal(NO_MODAL)}
              onCenter={() => cameraCommand(modal.sysid, { cmd: 'gimbal_center', args: { mode: 'one_key_reset' } })}
              clockSync={cameras.get(modal.sysid)?.caps.clock_sync ?? false}
              onSyncClock={() => cameraCommand(modal.sysid, { cmd: 'sync_clock' })}
              onPickRoi={(d, slot) => settingsFlow.startPick(modal.sysid, d, slot)}
              onSave={(d) => void settingsFlow.save(modal.sysid, d, cameras.get(modal.sysid)?.state)}
            />
          )}
          {settingsFlow.pickHint === 'picking' && (
            <div className="hint caution float map-c top1 row roi-pick-hint">
              {dict.roiPickHint}
              <button type="button" className="btn btn-sm" onClick={settingsFlow.cancelPick}>
                {dict.cancel}
              </button>
            </div>
          )}
          {modal.kind === 'mission-pick' && (
            <MissionWriteSheet vehicleName={vehicles.get(modal.sysid)?.name ?? `#${modal.sysid}`} dict={dict} onClose={() => setModal(NO_MODAL)} onWrite={(row) => void writeSavedMission(modal.sysid, row.id)} />
          )}
          {modal.kind === 'present-settings' && (
            <PresentSettings isAdmin={me.role === 'admin'} logo={false} dict={dict} onClose={() => setModal(NO_MODAL)} />
          )}
          {modal.kind === 'guard-settings' && <GuardSettingsSheet isAdmin={me.role === 'admin'} dict={dict} onClose={() => setModal(NO_MODAL)} />}
          {modal.kind === 'env-sources' && <EnvSourcesSheet isAdmin={me.role === 'admin'} dict={dict} onClose={() => setModal(NO_MODAL)} />}
          {modal.kind === 'confirm' && (
            <ConfirmDialog
              sysid={modal.sysid}
              command={modal.command}
              message={modal.message}
              vehicleName={vehicles.get(modal.sysid)?.name ?? `#${modal.sysid}`}
              vehicle={vehicles.get(modal.sysid)}
              dict={dict}
              onCancel={() => setModal(NO_MODAL)}
              onDone={(r) => settle(modal.sysid, r, modal.command)}
            />
          )}
          {view !== 'mission' && view !== 'network' && logDock}
        </main>
      </div>
      {/* one banner for every view, fixed to the viewport (the frame scrolls on a phone) */}
      <GuardBanner alerts={guard.alerts} now={guard.now} dict={dict} tone={tone} onCancel={cancelAlert} onFocus={focusVehicle} />
    </div>
  )
}
