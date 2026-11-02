import type { MissionFrame, MissionItem, VehicleKind } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { CMDS, FRAMES, PALETTE, fieldsOf, isSurveyKey, type FieldSpec } from './cmds'
import { fieldLabel, fieldUnit, frameDesc, optionLabel, wpLabel } from './labels'
import { cmdKey } from './model'

interface Props {
  readonly item: MissionItem
  readonly seq: number
  readonly kind: VehicleKind | null
  readonly dict: Dict
  readonly onChange: (uid: number, patch: Partial<MissionItem>) => void
  readonly onCommand: (uid: number, cmdKey: string) => void
  readonly onDelete?: (uid: number) => void
  readonly uid?: number
}

const GROUPS: readonly { readonly key: 'pos' | 'do' | 'cond'; readonly label: keyof Dict }[] = [
  { key: 'pos', label: 'mPalPos' },
  { key: 'do', label: 'mPalDo' },
  { key: 'cond', label: 'mPalCond' },
]

function readField(it: MissionItem, f: FieldSpec): number {
  if (f.p <= 4) return it.params[f.p - 1] ?? 0
  return f.p === 5 ? it.lat : f.p === 6 ? it.lon : it.alt
}

function patchField(it: MissionItem, f: FieldSpec, value: number): Partial<MissionItem> {
  if (f.p <= 4) {
    const params = [...it.params] as [number, number, number, number]
    params[f.p - 1] = value
    return { params }
  }
  return f.p === 5 ? { lat: value } : f.p === 6 ? { lon: value } : { alt: value }
}

/** Prototype single-item editor `.sec`: badge + ウェイポイント編集 + 削除, then a `.form` of command, position, altitude and P-fields. */
export function ItemEditor({ item, seq, kind, dict, onChange, onCommand, onDelete, uid }: Props) {
  const id = uid ?? seq
  const key = cmdKey(item)
  const spec = CMDS[key]
  const fields = fieldsOf(key, kind)
  const num = (v: string) => (v === '' || Number.isNaN(Number(v)) ? 0 : Number(v))
  return (
    <div className="sec item-editor" data-testid="item-editor">
      <div className="row" style={{ gap: 10, marginBottom: 12 }}>
        <span className="count" style={{ minWidth: 26, height: 26, padding: '0 8px' }}>
          {seq}
        </span>
        <span className="h1">{dict.mWpEdit}</span>
        <div className="grow" />
        {onDelete && (
          <button type="button" className="btn btn-sm btn-danger" onClick={() => onDelete(id)}>
            {dict.mDeleteItem}
          </button>
        )}
      </div>
      <div className="form">
        <span>{dict.mCommand}</span>
        <div style={{ minWidth: 0 }}>
          <select className="rg-sel" aria-label={dict.mCommand} value={spec ? key : ''} style={{ width: '100%' }} onChange={(e) => onCommand(id, e.target.value)}>
            {!spec && <option value="">{key}</option>}
            {GROUPS.map((g) => (
              <optgroup key={g.key} label={dict[g.label]}>
                {PALETTE[g.key].filter((k) => !isSurveyKey(k)).map((k) => (
                  <option key={k} value={k}>
                    {wpLabel(k, dict)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <div className="row" style={{ gap: 8, marginTop: 5 }}>
            <span className="mono ell" style={{ fontSize: 11, color: 'var(--accent)' }}>
              {spec?.mav ?? `MAV_CMD #${item.command}`}
            </span>
            <span className="mono t4" style={{ fontSize: 10, flex: 'none' }}>
              {dict.mMavId} {item.command}
            </span>
            {spec?.deprecated && (
              <span className="rg-natag" style={{ color: 'var(--caution)', borderColor: 'var(--caution-line)' }}>
                {dict.mDeprecated}
              </span>
            )}
          </div>
        </div>
        {spec?.pos && (
          <>
            <span>{dict.mLat}</span>
            <input className="rg-num" aria-label={dict.mLat} type="number" step={0.000001} value={item.lat} style={{ minWidth: 0 }} onChange={(e) => onChange(id, { lat: num(e.target.value) })} />
            <span>{dict.mLon}</span>
            <input className="rg-num" aria-label={dict.mLon} type="number" step={0.000001} value={item.lon} style={{ minWidth: 0 }} onChange={(e) => onChange(id, { lon: num(e.target.value) })} />
          </>
        )}
        {spec?.alt && (
          <>
            <span>{dict.altitude}</span>
            <div className="row">
              <select className="rg-sel frame-sel" aria-label={dict.mFrame} value={item.frame} title={frameDesc(item.frame, dict)} onChange={(e) => onChange(id, { frame: e.target.value as MissionFrame })}>
                {(Object.keys(FRAMES) as MissionFrame[]).map((fr) => (
                  <option key={fr} value={fr}>
                    {FRAMES[fr].short}
                  </option>
                ))}
              </select>
              <input type="number" className="rg-num" aria-label={dict.altitude} step={1} value={item.alt} style={{ width: 90 }} onChange={(e) => onChange(id, { alt: num(e.target.value) })} />
              <span className="unit">m</span>
            </div>
            <span />
            <div className="t4" style={{ fontSize: 11, lineHeight: 1.4, marginTop: -6 }}>
              {frameDesc(item.frame, dict)}
            </div>
          </>
        )}
        {fields.map((f) => (
          <FieldRow key={f.key} f={f} item={item} dict={dict} num={num} onPatch={(patch) => onChange(id, patch)} />
        ))}
      </div>
    </div>
  )
}

interface FieldRowProps {
  readonly f: FieldSpec & { readonly unused: boolean }
  readonly item: MissionItem
  readonly dict: Dict
  readonly num: (v: string) => number
  readonly onPatch: (patch: Partial<MissionItem>) => void
}

function FieldRow({ f, item, dict, num, onPatch }: FieldRowProps) {
  const label = fieldLabel(f.key, dict)
  const value = readField(item, f)
  return (
    <>
      <span style={{ whiteSpace: 'nowrap' }}>
        <span className="rg-ptag">P{f.p}</span>
        {label}
      </span>
      <div className="row">
        {f.type === 'num' && (
          <>
            <input type="number" className="rg-num" aria-label={label} min={f.min} max={f.max} step={f.step ?? 'any'} value={value} disabled={f.unused} style={{ width: 100 }} onChange={(e) => onPatch(patchField(item, f, num(e.target.value)))} />
            <span className="unit">{fieldUnit(f.key)}</span>
          </>
        )}
        {f.type === 'sel' && (
          <select className="rg-sel" aria-label={label} value={String(value)} disabled={f.unused} style={{ flex: 1 }} onChange={(e) => onPatch(patchField(item, f, Number(e.target.value)))}>
            {(f.opts ?? []).map((o) => (
              <option key={o} value={String(o)}>
                {optionLabel(f, o, dict)}
              </option>
            ))}
          </select>
        )}
        {f.type === 'tog' && (
          <div className="rg-seg" role="group" aria-label={label}>
            <button type="button" className={value === 0 ? 'on' : ''} disabled={f.unused} onClick={() => onPatch(patchField(item, f, 0))}>
              {dict.optOff}
            </button>
            <button type="button" className={value !== 0 ? 'on' : ''} disabled={f.unused} onClick={() => onPatch(patchField(item, f, 1))}>
              {dict.optOn}
            </button>
          </div>
        )}
        {f.unused && (
          <span className="rg-natag" title={dict.mNaTitle}>
            {dict.mUnused}
          </span>
        )}
      </div>
    </>
  )
}
