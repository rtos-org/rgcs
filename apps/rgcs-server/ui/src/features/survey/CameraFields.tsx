// Camera picker + editable camera values for a survey. Picking copies the values into the spec
// (the spec never holds a camera id); user cameras can be updated or deleted, built-ins cannot.
import { Fragment, useState } from 'react'
import type { SurveyCamera } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { toValues, validCameraValues } from './cameraApi'
import type { SurveyCameraValues, SurveySpec } from './spec'

interface Props {
  readonly values: SurveyCameraValues
  readonly orientation: SurveySpec['orientation']
  readonly cameras: readonly SurveyCamera[]
  readonly dict: Dict
  readonly onChange: (values: SurveyCameraValues) => void
  readonly onOrientation: (o: SurveySpec['orientation']) => void
  readonly onPick: (values: SurveyCameraValues) => void
  readonly onSaveAs: (name: string) => void
  readonly onUpdate: (id: number) => void
  readonly onDelete: (id: number) => void
}

type NumKey = Exclude<keyof SurveyCameraValues, 'name' | 'shutterS'>
type DraftKey = NumKey | 'shutter'

const WHOLE: readonly DraftKey[] = ['imageWpx', 'imageHpx']

/** The number a text draft stands for, or null when it must not reach the spec. */
function parseDraft(key: DraftKey, text: string): number | null {
  const n = text.trim() === '' ? NaN : Number(text)
  if (!Number.isFinite(n)) return null
  if (key === 'shutter') return n >= 1 ? n : null
  if (n <= 0 || (WHOLE.includes(key) && !Number.isInteger(n))) return null
  return n
}

/** The typed text per field: shown while invalid or still matching the value; a valid one goes out at once. */
function useCameraDrafts(values: SurveyCameraValues, onChange: Props['onChange']) {
  const [drafts, setDrafts] = useState<Readonly<Partial<Record<DraftKey, string>>>>({})
  const canonical = (key: DraftKey): number => (key === 'shutter' ? (values.shutterS > 0 ? Math.round(1 / values.shutterS) : 0) : values[key])
  const shown = (key: DraftKey): string => {
    const draft = drafts[key]
    if (draft === undefined) return String(canonical(key))
    const parsed = parseDraft(key, draft)
    return parsed === null || parsed === canonical(key) ? draft : String(canonical(key))
  }
  const edit = (key: DraftKey, text: string) => {
    setDrafts((d) => ({ ...d, [key]: text }))
    const n = parseDraft(key, text)
    if (n === null) return
    onChange(key === 'shutter' ? { ...values, shutterS: 1 / n } : { ...values, [key]: n })
  }
  const invalid = (key: DraftKey) => drafts[key] !== undefined && parseDraft(key, drafts[key]) === null
  const valid = validCameraValues(values) && !(Object.keys(drafts) as DraftKey[]).some(invalid)
  return { shown, edit, invalid, valid, reset: () => setDrafts({}) }
}

/** 名前を付けて保存, and 更新 / 削除 (with a confirm step) for a picked user camera. */
function CameraSave({ dict, valid, userCamera, onSaveAs, onUpdate, onDelete }: Pick<Props, 'dict' | 'onSaveAs' | 'onUpdate' | 'onDelete'> & { valid: boolean; userCamera: SurveyCamera | undefined }) {
  const [saveName, setSaveName] = useState('')
  // the camera a delete waits to be confirmed for: picking another one drops the confirm step
  const [confirmFor, setConfirmFor] = useState<number | null>(null)
  const confirming = userCamera !== undefined && confirmFor === userCamera.id
  return (
    <>
      <label htmlFor="sv-save-name">{dict.svSaveName}</label>
      <div className="row">
        <input id="sv-save-name" className="in" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
        <button type="button" className="btn" disabled={!valid || saveName.trim() === ''} onClick={() => onSaveAs(saveName.trim())}>
          {dict.svSaveAs}
        </button>
      </div>
      {userCamera && (
        <>
          <span />
          <div className="row">
            <button type="button" className="btn" disabled={!valid} onClick={() => onUpdate(userCamera.id!)}>
              {dict.svCamUpdate}
            </button>
            <button type="button" className={`btn${confirming ? ' btn-danger' : ''}`} onClick={() => (confirming ? onDelete(userCamera.id!) : setConfirmFor(userCamera.id))}>
              {confirming ? dict.svCamDeleteConfirm : dict.svCamDelete}
            </button>
          </div>
        </>
      )}
    </>
  )
}

const FIELDS: readonly (readonly [DraftKey, keyof Dict, string])[] = [
  ['sensorWmm', 'svSensorW', '0.1'],
  ['sensorHmm', 'svSensorH', '0.1'],
  ['imageWpx', 'svImageW', '1'],
  ['imageHpx', 'svImageH', '1'],
  ['focalMm', 'svFocal', '0.1'],
  ['shutter', 'svShutter', '1'],
  ['minIntervalS', 'svMinInterval', '0.1'],
]

export function CameraFields({ values, orientation, cameras, dict, onChange, onOrientation, onPick, onSaveAs, onUpdate, onDelete }: Props) {
  const [pickedId, setPickedId] = useState<number | null>(null)
  const drafts = useCameraDrafts(values, onChange)
  const picked = cameras.find((c) => c.id === pickedId)
  const userCamera = picked && !picked.builtin && picked.id !== null ? picked : undefined
  const pick = (raw: string) => {
    const cam = cameras.find((c) => String(c.id) === raw)
    setPickedId(cam?.id ?? null)
    drafts.reset()
    if (cam) onPick(toValues(cam))
  }
  return (
    <div className="lb-form" data-testid="camera-fields">
      <label htmlFor="sv-pick">{dict.svCameraPick}</label>
      <select id="sv-pick" className="in" value={pickedId ?? ''} onChange={(e) => pick(e.target.value)}>
        <option value="">{dict.svCameraCustom}</option>
        {cameras.map((c) => (
          <option key={c.id} value={c.id ?? ''}>
            {c.name}
          </option>
        ))}
      </select>
      {FIELDS.map(([key, label, step]) => (
        <Fragment key={key}>
          <label htmlFor={`sv-${key}`}>{dict[label]}</label>
          <input id={`sv-${key}`} className="in" type="number" step={step} value={drafts.shown(key)} aria-invalid={drafts.invalid(key) || undefined} onChange={(e) => drafts.edit(key, e.target.value)} />
        </Fragment>
      ))}
      <span>{dict.svOrientation}</span>
      <div className="seg sm" role="group" aria-label={dict.svOrientation}>
        {(['landscape', 'portrait'] as const).map((o) => (
          <button key={o} type="button" className={orientation === o ? 'on' : ''} aria-pressed={orientation === o} onClick={() => onOrientation(o)}>
            {o === 'landscape' ? dict.svLandscape : dict.svPortrait}
          </button>
        ))}
      </div>
      <CameraSave dict={dict} valid={drafts.valid} userCamera={userCamera} onSaveAs={onSaveAs} onUpdate={onUpdate} onDelete={onDelete} />
    </div>
  )
}
