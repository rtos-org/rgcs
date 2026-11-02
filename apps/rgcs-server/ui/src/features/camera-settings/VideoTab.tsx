import type { CameraCaps, CameraKind, ThermalGain } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import type { Issue } from './schema'
import { PALETTES, type VideoDraft } from './videoSchema'

interface Props {
  readonly kind: CameraKind
  readonly caps: CameraCaps | undefined
  readonly draft: VideoDraft
  readonly issue: Issue | null
  readonly onChange: (next: VideoDraft) => void
  readonly dict: Dict
}

interface SegProps {
  readonly label: string
  readonly width: number
  readonly options: readonly { readonly label: string; readonly on: boolean; readonly pick: () => void }[]
}

/** A two-button `.seg.sm`; the lens hides while neither side is known (e.g. the gain before 0x37). */
function Seg2({ label, width, options }: SegProps) {
  const at = options.findIndex((o) => o.on)
  return (
    <div className="seg sm" role="group" aria-label={label} style={{ width }}>
      <span className="lens" style={{ transform: `translateX(${Math.max(at, 0) * 100}%)`, opacity: at < 0 ? 0 : 1 }} />
      {options.map((o) => (
        <button key={o.label} type="button" className={o.on ? 'on' : ''} onClick={o.pick}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

const onOff = (value: boolean, set: (v: boolean) => void) => [
  { label: 'On', on: value, pick: () => set(true) },
  { label: 'Off', on: !value, pick: () => set(false) },
]

/** Prototype 映像 tab (lines 1277–1290): rows gated per capability, then auto record and the note. */
export function VideoTab({ kind, caps, draft, issue, onChange, dict }: Props) {
  if (kind === 'none') return <div className="t3" style={{ fontSize: 12 }}>{dict.camNoneNote}</div>
  const set = (p: Partial<VideoDraft>) => onChange({ ...draft, ...p })
  const presets = caps?.encoding_presets ?? []
  const thermal = caps?.thermal != null
  const gains: readonly ThermalGain[] = ['high', 'low']
  const showMedia = presets.length > 0 || thermal || caps?.ai_tracking != null
  return (
    <>
      {showMedia && (
        <div className="form">
          {presets.length > 0 && (
            <>
              <span>{dict.camEncoding}</span>
              <select className="in" aria-label={dict.camEncoding} value={draft.encoding_preset} onChange={(e) => set({ encoding_preset: e.target.value as VideoDraft['encoding_preset'] })}>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </>
          )}
          {thermal && (
            <>
              <span>{dict.camPalette}</span>
              <select className="in" aria-label={dict.camPalette} value={String(draft.thermal_palette)} onChange={(e) => set({ thermal_palette: Number(e.target.value) })}>
                {PALETTES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <span>{dict.camGain}</span>
              <Seg2 label={dict.camGain} width={200} options={gains.map((g) => ({ label: g === 'high' ? 'High' : 'Low', on: draft.gain === g, pick: () => set({ gain: g }) }))} />
              {draft.gain !== null && (
                <>
                  <span />
                  <span className="t3" style={{ fontSize: 11 }}>
                    {draft.gain === 'high' ? dict.camRangeHigh : dict.camRangeLow}
                  </span>
                </>
              )}
              <span>{dict.camTempOverlay}</span>
              <Seg2 label={dict.camTempOverlay} width={120} options={onOff(draft.thermal_overlay, (thermal_overlay) => set({ thermal_overlay }))} />
            </>
          )}
          {caps?.ai_tracking != null && (
            <>
              <span>{dict.camAiBox}</span>
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="number"
                  className={issue?.path === 'ai_box_px' ? 'in num invalid' : 'in num'}
                  aria-label={dict.camAiBox}
                  value={draft.ai_box_px}
                  onChange={(e) => set({ ai_box_px: Number(e.target.value) })}
                  style={{ width: 80 }}
                />
                <span className="t3">px</span>
              </div>
            </>
          )}
        </div>
      )}
      <div className="form">
        <span>{dict.camAutoRec}</span>
        <Seg2 label={dict.camAutoRec} width={120} options={onOff(draft.auto_record, (auto_record) => set({ auto_record }))} />
      </div>
      <div className="t3" style={{ fontSize: 11 }}>
        {dict.camVideoNote}
      </div>
      {issue && <span className="danger settings-issue">{issue.path}: {issue.message}</span>}
    </>
  )
}
