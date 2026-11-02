// Right panels of the Fence and Rally tabs (user request 2026-10-20): summary, FENCE_ALT_MAX,
// write / read the vehicle and save / load files. The lists stay in the left panels.
import { useRef, useState } from 'react'
import type { FenceParams, FenceZone, RallyPoint } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconWarn } from '../../shared/ui/icons'
import { CollapseButton } from './PlanRail'

export interface PlanStatus {
  readonly ok: boolean
  readonly text: string
}

interface IoProps {
  readonly sysid: number | null
  /** The target's name: shown above the write button, so the write never goes to an unnamed vehicle. */
  readonly targetName?: string
  readonly busy: boolean
  readonly status: PlanStatus | null
  readonly dict: Dict
  readonly onWrite: () => void
  readonly onRead: () => void
  /** Folds the panel to its rail. */
  readonly onCollapse?: () => void
}

function IoFooter({ sysid, targetName, busy, status, dict, onWrite, onRead, note, labels }: IoProps & { readonly note: string; readonly labels: readonly [string, string] }) {
  return (
    <div className="hair-t plan-io">
      <div className="t3 plan-note">{note}</div>
      {status && <div className={status.ok ? 't3' : 'hint caution'}>{status.text}</div>}
      {sysid === null ? <div className="t3">{dict.planNoVehicle}</div> : <div className="t2">{`${dict.mVehicle}: ${targetName ?? `#${sysid}`}`}</div>}
      <div className="plan-io-btns">
        <button type="button" className="btn btn-primary" disabled={sysid === null || busy} onClick={onWrite}>
          {labels[0]}
        </button>
        <button type="button" className="btn" disabled={sysid === null || busy} onClick={onRead}>
          {labels[1]}
        </button>
      </div>
    </div>
  )
}


/** A caution line, not a button-like pill. */
function Notice({ text }: { readonly text: string }) {
  return (
    <div className="plan-notice row">
      <IconWarn size={14} />
      <span>{text}</span>
    </div>
  )
}

/** FENCE_ALT_MAX: shown, settable, with whether ArduPilot enforces it. */
function AltMaxBox({ params, busy, dict, onSet }: { readonly params: FenceParams | null; readonly busy: boolean; readonly dict: Dict; readonly onSet: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const known = params?.alt_max ?? null
  const text = draft ?? (known === null ? '' : String(Math.round(known)))
  const value = Number(text)
  const valid = text !== '' && Number.isFinite(value) && value > 0
  return (
    <div className="hair plan-altmax" data-testid="fence-alt-max">
      <label className="row" style={{ gap: 8 }}>
        <span className="grow">{dict.fenceAltMax}</span>
        <input className="in num" type="number" min={1} step={1} aria-label={dict.fenceAltMax} style={{ width: 80 }} value={text} placeholder="—" onChange={(e) => setDraft(e.target.value)} />
        <span className="t3">m</span>
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy || !valid || draft === null}
          onClick={() => {
            onSet(value)
            setDraft(null)
          }}
        >
          {dict.fenceAltMaxSet}
        </button>
      </label>
      <div className="t3 plan-note">
        {known === null ? dict.fenceAltMaxUnknown : dict.fenceAltMaxNote}
        {params?.alt_max_on === false && <Notice text={dict.fenceAltMaxOff} />}
        {params?.enabled === false && <Notice text={dict.fenceDisabled} />}
      </div>
    </div>
  )
}


interface FileProps {
  readonly onSaveFile: () => void
  readonly onLoadFile: (file: File) => void
}

/** ファイルに保存 / ファイルから読込 (WPL for Mission Planner; QGC `.plan` also read). */
function FileButtons({ dict, empty, onSaveFile, onLoadFile }: FileProps & { readonly dict: Dict; readonly empty: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="plan-io-btns">
      <button type="button" className="btn" disabled={empty} onClick={onSaveFile}>
        {dict.mFileWaypoints}
      </button>
      <button type="button" className="btn" onClick={() => input.current?.click()}>
        {dict.mFileLoad}
      </button>
      <input
        ref={input}
        type="file"
        accept=".waypoints,.txt,.plan,.fen,.ral"
        aria-label={dict.mFileLoad}
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onLoadFile(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

interface FenceSideProps extends IoProps, FileProps {
  readonly zones: readonly FenceZone[]
  /** The target vehicle's FENCE_* parameters (null until read). */
  readonly fenceParams: FenceParams | null
  readonly onAltMax: (value: number) => void
}

export function FenceSidebar(p: FenceSideProps) {
  const { zones, dict } = p
  const inc = zones.filter((z) => z.inclusion).length
  return (
    <aside className="g panel float float-r mission-right" aria-label={dict.plFenceSide}>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div className="sec">
          <div className="row" style={{ marginBottom: 12, gap: 8 }}>
            <span className="h1">{dict.fenceTitle}</span>
            <div className="grow" />
            {p.onCollapse && <CollapseButton dict={dict} onCollapse={p.onCollapse} />}
          </div>
          <div className="num summary-grid" data-testid="fence-summary">
            <span className="t2">{dict.fenceInclusion}</span>
            <span className="num">{inc}</span>
            <span className="t2">{dict.fenceExclusion}</span>
            <span className="num">{zones.length - inc}</span>
          </div>
        </div>
        <AltMaxBox params={p.fenceParams} busy={p.busy} dict={dict} onSet={p.onAltMax} />
      </div>
      <IoFooter {...p} note={dict.fenceNote} labels={[dict.fenceWrite, dict.fenceRead]} />
      <div className="plan-io">
        <FileButtons dict={dict} empty={zones.length === 0} onSaveFile={p.onSaveFile} onLoadFile={p.onLoadFile} />
      </div>
    </aside>
  )
}

interface RallySideProps extends IoProps, FileProps {
  readonly points: readonly RallyPoint[]
}

export function RallySidebar(p: RallySideProps) {
  const { points, dict } = p
  return (
    <aside className="g panel float float-r mission-right" aria-label={dict.plRallySide}>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div className="sec">
          <div className="row" style={{ marginBottom: 12, gap: 8 }}>
            <span className="h1">{dict.rallyTitle}</span>
            <div className="grow" />
            {p.onCollapse && <CollapseButton dict={dict} onCollapse={p.onCollapse} />}
          </div>
          <div className="num summary-grid" data-testid="rally-summary">
            <span className="t2">{dict.rallyTitle}</span>
            <span className="num">{points.length}</span>
          </div>
        </div>
      </div>
      <IoFooter {...p} note={dict.rallyNote} labels={[dict.rallyWrite, dict.rallyRead]} />
      <div className="plan-io">
        <FileButtons dict={dict} empty={points.length === 0} onSaveFile={p.onSaveFile} onLoadFile={p.onLoadFile} />
      </div>
    </aside>
  )
}
