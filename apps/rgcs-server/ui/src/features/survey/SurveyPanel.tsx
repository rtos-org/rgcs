// Right-side panel for one survey: camera, settings, numbers, warnings and
// 「ウェイポイントに展開」. Every change regenerates the survey's items as one undo step.
import type { Dict } from '../../shared/i18n'
import { CameraFields } from './CameraFields'
import { SurveyFields } from './SurveyFields'
import { SurveyNumbers } from './SurveyNumbers'
import { SurveyWarnings } from './SurveyWarnings'
import type { SurveyRejection } from './useSurvey'
import type { SurveyEditor } from './useSurveyEditor'
import { useSurveyCameras, type SurveyCameraError } from './useSurveyCameras'

const REJECTION_TEXT: Readonly<Record<SurveyRejection, keyof Dict>> = {
  invalid_polygon: 'svInvalidPolygon',
  invalid_spec: 'svInvalidSpec',
  too_large: 'svTooLarge',
}

const CAMERA_ERROR_TEXT: Readonly<Record<SurveyCameraError['code'], keyof Dict>> = {
  load_failed: 'svCamLoadFailed',
  save_failed: 'svCamSaveFailed',
  invalid: 'svCamInvalid',
}

/** The dictionary's reason; the server's own message only as a small secondary line. */
function CameraError({ error, dict }: { error: SurveyCameraError; dict: Dict }) {
  return (
    <div className="hint caution sv-warn">
      <div>{dict[CAMERA_ERROR_TEXT[error.code]]}</div>
      {error.detail && <div className="t3 sv-detail">{error.detail}</div>}
    </div>
  )
}

interface Props {
  /** A selected item of the survey. */
  readonly uid: number
  readonly dict: Dict
  /** The mission screen's survey editor (shared with the map). */
  readonly sv: SurveyEditor
}

export function SurveyPanel({ uid, dict, sv }: Props) {
  const cams = useSurveyCameras()
  const survey = sv.surveyFor(uid)
  if (!survey) return null
  const { id, spec } = survey
  const m = sv.metrics(id)
  const rejected = sv.rejectedFor(id)
  const set = (patch: Parameters<typeof sv.update>[1], phase?: Parameters<typeof sv.update>[2]) => sv.update(id, patch, phase)
  return (
    <div className="sec survey-panel" data-testid="survey-panel">
      <div className="row" style={{ gap: 10, marginBottom: 12 }}>
        <span className="h1">{dict.svPanelTitle}</span>
        <span className="t2 sv-name">{spec.name}</span>
      </div>
      {cams.error && <CameraError error={cams.error} dict={dict} />}
      {/* camera values are typed per keystroke: previewed live, committed on blur / Enter */}
      <div onBlur={() => set({}, 'done')} onKeyDown={(e) => e.key === 'Enter' && set({}, 'done')}>
        <CameraFields
          values={spec.camera}
          orientation={spec.orientation}
          cameras={cams.cameras}
          dict={dict}
          onChange={(camera) => set({ camera }, 'live')}
          onOrientation={(orientation) => set({ orientation })}
          onPick={(camera) => set({ camera })}
          onSaveAs={(name) => void cams.saveAs(spec.camera, name)}
          onUpdate={(cid) => void cams.update(cid, spec.camera)}
          onDelete={(cid) => void cams.remove(cid)}
        />
      </div>
      <SurveyFields spec={spec} metrics={m} dict={dict} onChange={set} />
      {rejected && <div className="hint caution sv-warn">{dict[REJECTION_TEXT[rejected]]}</div>}
      {m ? <SurveyNumbers spec={spec} metrics={m} dict={dict} /> : !rejected && <div className="hint caution sv-warn">{dict.svInvalidPolygon}</div>}
      {m && <SurveyWarnings spec={spec} metrics={m} dict={dict} />}
      <button type="button" className="btn sv-expand" onClick={() => sv.expand(id)}>
        {dict.svExpand}
      </button>
    </div>
  )
}
