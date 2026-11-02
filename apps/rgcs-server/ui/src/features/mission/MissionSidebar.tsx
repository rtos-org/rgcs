import type { Finding, MissionFrame, MissionStats, MissionTransfer, VehicleKind, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { FRAMES } from './cmds'
import { ItemEditor } from './ItemEditor'
import { surveyAt } from '../survey/draftOps'
import { SurveyPanel } from '../survey/SurveyPanel'
import type { SurveyEditor } from '../survey/useSurveyEditor'
import { durText, km } from './labels'
import type { Draft, DraftItem, TakeoffKey } from './model'
import { findingDetail } from './findingDetail'
import { findingFix, type FixInput } from './findingFix'
import { findingText, type LocalWarning } from './summary'
import { CollapseButton } from './PlanRail'
import { TransferBar } from './TransferBar'

interface Props {
  readonly draft: Draft
  readonly selectedItems: readonly DraftItem[]
  readonly vehicles: readonly VehicleState[]
  readonly sysid: number | null
  readonly transfer?: MissionTransfer | null
  readonly kind: VehicleKind | null
  readonly stats: MissionStats
  readonly warnings: readonly LocalWarning[]
  readonly findings: readonly Finding[]
  readonly dirty: boolean
  readonly busy: boolean
  readonly dict: Dict
  readonly bulk: { readonly alt: string; readonly frame: MissionFrame }
  readonly onBulk: (next: { alt: string; frame: MissionFrame }) => void
  readonly onApplyBulk: () => void
  readonly onDeselect: () => void
  readonly onDeleteSelected: () => void
  readonly onMeta: (patch: Partial<Draft['mission']>) => void
  readonly onItemChange: (uid: number, patch: Parameters<React.ComponentProps<typeof ItemEditor>['onChange']>[1]) => void
  readonly onItemCommand: (uid: number, key: string) => void
  /** The airframe's takeoff, for the 「先頭に離陸を追加」 fix. */
  readonly takeoff: TakeoffKey | null
  /** Applies a warning's one-click fix as an ordinary (undoable) edit. */
  readonly onFix: (apply: (d: Draft) => Draft) => void
  readonly onNew: () => void
  readonly onOpen: () => void
  readonly onSave: () => void
  readonly onUpload: () => void
  /** 機体から読込: next to 機体に書き込む. */
  readonly onRead: () => void
  readonly canRead: boolean
  /** 「UAV-02 から読込」 when the ops selection stands in for a missing target. */
  readonly readLabel?: string
  /** Why there is no target, when more specific than 「選んでください」 (e.g. the saved vehicle is offline). */
  readonly targetHint?: string | null
  readonly onSaveFile: () => void
  readonly onSaveRgcs: () => void
  /** The plan comparison table (two or more missions open), above the summary. */
  readonly compare?: React.ReactNode
  /** Folds the panel to its rail. */
  readonly onCollapse?: () => void
  /** Several missions open: the vehicle is the row's assignment, which may be none (未割当). */
  readonly multi?: boolean
  /** Survey editing: a selected item inside a survey opens its panel instead of the item editor. */
  readonly survey?: SurveyEditor
}

/** Right panel after the prototype: ミッション settings, selection editor, サマリ, write / save buttons. */
export function MissionSidebar(p: Props) {
  const { draft, selectedItems, dict } = p
  const m = draft.mission
  const only = selectedItems.length === 1 ? selectedItems[0] : undefined
  const hostSurvey = only ? surveyAt(draft, only.uid) : null
  const posCount = draft.items.filter((it) => it.command >= 16 && it.command <= 22).length
  return (
    <aside className="g panel float float-r mission-right" aria-label="editor">
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div className="sec">
          <div className="row" style={{ marginBottom: 12, gap: 8 }}>
            <span className="h1">{dict.navMission}</span>
            {p.dirty && <span className="rg-natag mission-dirty">{dict.mDirty}</span>}
            <div className="grow" />
            {/* one group: it wraps below the title as a whole when the row is too narrow */}
            <span className="row mission-head-btns">
              <button type="button" className="btn btn-sm btn-ghost" onClick={p.onNew}>
                {dict.mNew}
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={p.onOpen}>
                {dict.mOpen}
              </button>
              <button type="button" className="btn btn-sm" disabled={p.busy} onClick={p.onSave}>
                {dict.mSave}
              </button>
              {p.onCollapse && <CollapseButton dict={dict} onCollapse={p.onCollapse} />}
            </span>
          </div>
          <div className="form">
            <span>{dict.mName}</span>
            <input className="in" aria-label={dict.mName} value={m.name} onChange={(e) => p.onMeta({ name: e.target.value })} />
            <span>{dict.mVehicle}</span>
            <select className="in" aria-label={dict.mVehicle} value={p.sysid ?? ''} onChange={(e) => p.onMeta({ sysid: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">{p.vehicles.length === 0 ? dict.mNoVehicle : dict.plUnassigned}</option>
              {p.vehicles.map((v) => (
                <option key={v.sysid} value={v.sysid}>
                  {v.name}
                </option>
              ))}
            </select>
            {p.kind !== 'rover' && <DefaultAlt mission={m} dict={dict} onMeta={p.onMeta} />}
            <span>{dict.mSpeed}</span>
            <div className="row">
              <input type="number" className="rg-num" aria-label={dict.mSpeed} step={0.5} value={m.speed} style={{ width: 90 }} onChange={(e) => p.onMeta({ speed: Number(e.target.value) || 0 })} />
              <span className="unit">m/s</span>
            </div>
          </div>
        </div>
        {selectedItems.length > 1 && (
          <div className="sec" data-testid="bulk-edit">
            <div className="row" style={{ gap: 10, marginBottom: 10 }}>
              <span className="count">{selectedItems.length}</span>
              <span className="h1">{dict.mSelectedCount}</span>
              <div className="grow" />
              <button type="button" className="btn btn-sm" onClick={p.onDeselect}>
                {dict.mDeselect}
              </button>
            </div>
            <div className="t3" style={{ fontSize: 12, marginBottom: 10 }}>
              {dict.mMultiNote}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <span className="t2">{dict.altitude}</span>
              <div className="row" style={{ gap: 6 }}>
                <select className="rg-sel frame-sel" aria-label={`bulk-${dict.mFrame}`} value={p.bulk.frame} onChange={(e) => p.onBulk({ ...p.bulk, frame: e.target.value as MissionFrame })}>
                  {(Object.keys(FRAMES) as MissionFrame[]).map((f) => (
                    <option key={f} value={f}>
                      {FRAMES[f].short}
                    </option>
                  ))}
                </select>
                <input type="number" className="rg-num" aria-label={`bulk-${dict.altitude}`} value={p.bulk.alt} style={{ flex: 1, minWidth: 0 }} onChange={(e) => p.onBulk({ ...p.bulk, alt: e.target.value })} />
              </div>
              <button type="button" className="btn" style={{ padding: '0 12px' }} onClick={p.onApplyBulk}>
                {dict.mApplyAll}
              </button>
            </div>
            <button type="button" className="btn btn-danger" style={{ width: '100%' }} onClick={p.onDeleteSelected}>
              {dict.mDeleteSel}
            </button>
          </div>
        )}
        {only && hostSurvey && p.survey && <SurveyPanel key={hostSurvey.id} uid={only.uid} dict={dict} sv={p.survey} />}
        {only && !(hostSurvey && p.survey) && (
          <ItemEditor item={only} uid={only.uid} seq={draft.items.indexOf(only) + 1} kind={p.kind} dict={dict} onChange={p.onItemChange} onCommand={p.onItemCommand} onDelete={() => p.onDeleteSelected()} />
        )}
        {p.compare}
        <div className="sec" data-testid="mission-summary">
          <div className="h1" style={{ marginBottom: 8 }}>
            {dict.mSummary}
          </div>
          <div className="num summary-grid">
            <span className="t2">{dict.mWaypoints}</span>
            <span>{posCount}</span>
            <span className="t2">{dict.mCommands}</span>
            <span>{draft.items.length}</span>
            <span className="t2">{dict.mDistance}</span>
            <span>{km(p.stats.distance_m)}</span>
            <span className="t2">{dict.mEstTime}</span>
            <span>{durText(p.stats.duration_s, dict)}</span>
            {p.kind !== 'rover' && <span className="t2">{dict.mMaxAlt}</span>}
            {p.kind !== 'rover' && <span>{`${Math.round(p.stats.max_alt)} m`}</span>}
          </div>
          {p.findings.map((f, i) => (
            <WarnRow key={`f${i}`} f={f} fatal={f.level === 'fatal'} detail={findingDetail(f, draft.items, dict)} p={p} />
          ))}
          {p.warnings
            .filter((w) => !p.findings.some((f) => f.code === w.code))
            .map((w, i) => (
              <WarnRow key={`w${i}`} f={w} fatal={false} detail={null} p={p} />
            ))}
        </div>
      </div>
      <div className="hair-t" style={{ display: 'grid', gap: 8, padding: 12 }}>
        <div className="mission-io">
          <button type="button" className="btn btn-lg btn-primary" disabled={draft.items.length === 0 || p.sysid === null || p.busy} onClick={p.onUpload}>
            {dict.mWrite}
          </button>
          <button type="button" className="btn btn-lg" disabled={!p.canRead} onClick={p.onRead}>
            {p.readLabel ?? dict.mRead}
          </button>
        </div>
        {p.sysid === null && p.vehicles.length > 0 && <div className="t3" style={{ fontSize: 11 }}>{p.multi ? dict.plAssignToWrite : (p.targetHint ?? dict.mPickTarget)}</div>}
        <TransferBar transfer={p.transfer} dict={dict} />
        <div className="mission-io">
          <button type="button" className="btn btn-sm" disabled={p.busy} onClick={p.onSaveFile}>
            {dict.mFileWaypoints}
          </button>
          <button type="button" className="btn btn-sm" onClick={p.onSaveRgcs}>
            {dict.mFileRgcs}
          </button>
        </div>
      </div>
    </aside>
  )
}

/** 既定高度 (frame + altitude): absent for a rover target. */
function DefaultAlt({ mission: m, dict, onMeta }: { readonly mission: Draft['mission']; readonly dict: Dict; readonly onMeta: Props['onMeta'] }) {
  return (
    <>
      <span>{dict.mDefaultAlt}</span>
      <div className="row">
        <select className="rg-sel frame-sel" aria-label={dict.mFrame} value={m.default_frame} onChange={(e) => onMeta({ default_frame: e.target.value as MissionFrame })}>
          {(Object.keys(FRAMES) as MissionFrame[]).map((f) => (
            <option key={f} value={f}>
              {FRAMES[f].short}
            </option>
          ))}
        </select>
        <input type="number" className="rg-num" aria-label={dict.mDefaultAlt} value={m.default_alt} style={{ width: 90 }} onChange={(e) => onMeta({ default_alt: Number(e.target.value) || 0 })} />
        <span className="unit">m</span>
      </div>
    </>
  )
}

function WarnRow({ f, fatal, detail, p }: { f: FixInput; fatal: boolean; detail: string | null; p: Props }) {
  const fix = findingFix(f, p.draft, { takeoff: p.takeoff, dict: p.dict })
  return (
    <div className={`warnbox${fatal ? ' fatal' : ''}${fix ? ' with-fix' : ''}`} role="listitem">
      <span className="seq">{f.seq !== null ? `#${f.seq}` : ''}</span>
      <span className="grow">
        {findingText(f.code, p.dict)}
        {detail && <span className="warn-detail">{detail}</span>}
        {fix && (
          <button type="button" className="btn btn-sm warn-fix" onClick={() => p.onFix(fix.apply)}>
            {fix.label}
          </button>
        )}
      </span>
    </div>
  )
}
