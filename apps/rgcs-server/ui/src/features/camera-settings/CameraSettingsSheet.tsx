import { useState } from 'react'
import type { CameraCaps, CameraProfile, CameraState, GimbalInputProfile, RoiControl, RoiTarget } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconClose } from '../../shared/ui/icons'
import { profileSchema } from '../gimbal-joystick'
import { RoiTab } from '../roi/RoiTab'
import { DEFAULT_ROI_CONTROL, emptyTargets, nextEmptySlot, roiControlSchema, roiTargetsSchema } from '../roi/schema'
import { ConnectionTab } from './ConnectionTab'
import { InputTab } from './InputTab'
import { cameraProfileSchema, firstIssue, type CameraProfileDraft } from './schema'
import { VideoTab } from './VideoTab'
import { startVideoDraft, videoSchema, type VideoDraft } from './videoSchema'

export type Tab = 'connection' | 'input' | 'roi' | 'video'

/** Everything the sheet edits; it survives the 地図で指定 round trip. */
export interface SheetDraft {
  readonly tab: Tab
  readonly camera: CameraProfileDraft
  readonly input: GimbalInputProfile
  readonly roiTargets: readonly RoiTarget[]
  readonly roiControl: RoiControl
  readonly video: VideoDraft
}

interface Props {
  readonly sysid: number
  readonly profile: CameraProfile
  readonly inputProfile: GimbalInputProfile
  readonly cameraState: CameraState | undefined
  /** The live camera's caps; the 映像 rows are gated on them (undefined: none known). */
  readonly caps: CameraCaps | undefined
  readonly gamepadIds: readonly string[]
  /** `caps.roi !== 'none'`. */
  readonly roiSupported: boolean
  /** The saved presets and control; null when they could not be loaded (the ROI tab stays off). */
  readonly roi: { readonly targets: readonly RoiTarget[]; readonly control: RoiControl } | null
  readonly activeRoi: string | null
  /** Restored after a map pick. */
  readonly initial?: SheetDraft
  /** A caution line above the tabs (e.g. the pick used a fallback elevation). */
  readonly notice?: string | null
  readonly onPickRoi: (draft: SheetDraft, slot: number) => void
  readonly onSave: (draft: SheetDraft) => void
  readonly onCancel: () => void
  readonly onCenter: () => void
  /** `caps.clock_sync`; 今すぐ同期 is enabled only with it and a live connection. */
  readonly clockSync: boolean
  /** Sends `{cmd: 'sync_clock'}`; failures land in the log. */
  readonly onSyncClock: () => void
  readonly dict: Dict
}

const TABS: readonly Tab[] = ['connection', 'input', 'roi', 'video']

function startDraft(profile: CameraProfile, inputProfile: GimbalInputProfile, roi: Props['roi'], cameraState: CameraState | undefined): SheetDraft {
  return {
    tab: 'connection',
    camera: { kind: profile.kind, host: profile.host, port: profile.port, video_source_mode: profile.video_source_mode, rtsp_url: profile.rtsp_url, comp_id: profile.comp_id },
    input: inputProfile,
    roiTargets: roi?.targets ?? emptyTargets(),
    roiControl: roi?.control ?? DEFAULT_ROI_CONTROL,
    video: startVideoDraft(profile, cameraState),
  }
}

/** The camera settings sheet (prototype camera settings): 接続 / 操作 / ROI / 映像. zod blocks invalid saves. */
export function CameraSettingsSheet(props: Props) {
  const { profile, inputProfile, cameraState, caps, gamepadIds, roiSupported, roi, activeRoi, initial, notice, onPickRoi, onSave, onCancel, onCenter, clockSync, onSyncClock, dict } = props
  const [draft, setDraft] = useState<SheetDraft>(() => initial ?? startDraft(profile, inputProfile, roi, cameraState))
  const [csvError, setCsvError] = useState<string | null>(null)
  const patch = (p: Partial<SheetDraft>) => setDraft((d) => ({ ...d, ...p }))
  const roiOn = roiSupported && roi !== null
  const tab = draft.tab === 'roi' && !roiOn ? 'connection' : draft.tab
  const cameraIssue = firstIssue(cameraProfileSchema.safeParse(draft.camera))
  const inputIssue = firstIssue(profileSchema.safeParse(draft.input))
  const targetsIssue = firstIssue(roiTargetsSchema.safeParse(draft.roiTargets))
  const controlIssue = firstIssue(roiControlSchema.safeParse(draft.roiControl))
  const videoIssue = firstIssue(videoSchema.safeParse(draft.video))
  const valid = cameraIssue === null && inputIssue === null && targetsIssue === null && controlIssue === null && videoIssue === null
  const name = `UAV-${String(profile.sysid).padStart(2, '0')}`
  const tabButton = (t: Tab, label: string, enabled: boolean, title?: string) =>
    enabled ? (
      <button type="button" className={tab === t ? 'on' : ''} onClick={() => patch({ tab: t })}>
        {label}
      </button>
    ) : (
      <button type="button" aria-disabled="true" title={title} className="off">
        {label}
      </button>
    )
  return (
    <aside className="g-strong panel sheet settings" aria-label={dict.cameraSettings}>
      <div className="panel-h">
        <span className="h1">{name}</span>
        <span className="h1 t2" style={{ fontWeight: 300 }}>
          {dict.cameraSettings}
        </span>
        <span className="grow" />
        <button type="button" className="btn-icon" aria-label={dict.close} title={dict.close} onClick={onCancel}>
          <IconClose />
        </button>
      </div>
      <div className="settings-tabs">
        <div className="seg n4" role="group" style={{ height: 36 }}>
          <span className="lens" style={{ transform: `translateX(${TABS.indexOf(tab) * 100}%)` }} />
          {tabButton('connection', dict.tabConnection, true)}
          {tabButton('input', dict.tabInput, true)}
          {tabButton('roi', dict.tabRoi, roiOn, roiSupported ? dict.roiUnavailable : dict.roiUnsupported)}
          {tabButton('video', dict.tabVideo, true)}
        </div>
      </div>
      <div className="sheet-body settings-body">
        {notice && <div className="hint caution settings-notice">{notice}</div>}
        {tab === 'connection' && <ConnectionTab draft={draft.camera} issue={cameraIssue} cameraState={cameraState} onChange={(camera) => patch({ camera })} clockSync={clockSync} onSyncClock={onSyncClock} dict={dict} />}
        {tab === 'input' && <InputTab draft={draft.input} issue={inputIssue} gamepadIds={gamepadIds} onChange={(input) => patch({ input })} onCenter={onCenter} dict={dict} />}
        {tab === 'video' && <VideoTab kind={draft.camera.kind} caps={caps} draft={draft.video} issue={videoIssue} onChange={(video) => patch({ video })} dict={dict} />}
        {tab === 'roi' && (
          <>
            <RoiTab
              targets={draft.roiTargets}
              control={draft.roiControl}
              activeId={activeRoi}
              targetsIssue={targetsIssue}
              controlIssue={controlIssue}
              onTargets={(roiTargets) => {
                setCsvError(null)
                patch({ roiTargets })
              }}
              onControl={(roiControl) => patch({ roiControl })}
              onPickOnMap={() => onPickRoi({ ...draft, tab: 'roi' }, nextEmptySlot(draft.roiTargets))}
              onCsvError={setCsvError}
              roiMode={caps?.roi}
              dict={dict}
            />
            {csvError && <span className="danger settings-issue">{csvError}</span>}
          </>
        )}
      </div>
      <div className="settings-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {dict.cancel}
        </button>
        <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => onSave({ ...draft, tab })}>
          {dict.save}
        </button>
      </div>
    </aside>
  )
}
