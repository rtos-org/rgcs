// Mission / Fence / Rally planner tabs and the left panels (lists) of the fence and rally tabs
// (user request 2026-10-19). The data lives in the plan (`draft.mission.fence / .rally`); these
// panels only show it and report the operator's choices.
import type { FenceZone, RallyPoint } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconClose } from '../../shared/ui/icons'
import type { PlanTab } from './fenceMap'
import { fenceFindings } from './geofenceModel'
import { PLAN_TABS as TABS, savePlanTab } from './planTab'

export type { PlanStatus } from './PlanSidebar'

export function PlanTabs({ tab, dict, onChange }: { readonly tab: PlanTab; readonly dict: Dict; readonly onChange: (t: PlanTab) => void }) {
  const label = { mission: dict.planMission, fence: dict.planFence, rally: dict.planRally }
  return (
    <div className="g-ctl seg float map-c top1 plan-tabs" role="group" aria-label={dict.planTabs}>
      <span className="lens" style={{ width: `${100 / TABS.length}%`, transform: `translateX(${TABS.indexOf(tab) * 100}%)` }} />
      {TABS.map((t) => (
        <button
          key={t}
          type="button"
          className={t === tab ? 'on' : ''}
          onClick={() => {
            savePlanTab(t)
            onChange(t)
          }}
        >
          {label[t]}
        </button>
      ))}
    </div>
  )
}

export interface ArmedZone {
  readonly kind: FenceZone['kind']
  readonly inclusion: boolean
}

function zoneTitle(z: FenceZone, dict: Dict): string {
  const kind = z.kind === 'polygon' ? (z.inclusion ? dict.fenceAddIncPoly : dict.fenceAddExcPoly) : z.inclusion ? dict.fenceAddIncCircle : dict.fenceAddExcCircle
  return z.kind === 'polygon' ? `${kind} · ${z.vertices.length} ${dict.fencePoints}` : kind
}

interface FenceProps {
  readonly dict: Dict
  readonly zones: readonly FenceZone[]
  readonly armed: ArmedZone | null
  /** The polygon being drawn (vertices are added by map clicks). */
  readonly drawing: number | null
  readonly onArm: (z: ArmedZone) => void
  readonly onDone: () => void
  readonly onRadius: (zone: number, radius: number) => void
  readonly onInclusion: (zone: number, inclusion: boolean) => void
  readonly onRemove: (zone: number) => void
}

export function FencePanel(p: FenceProps) {
  const { zones, armed, drawing, dict } = p
  const bad = new Set(fenceFindings(zones).map((f) => f.zone))
  const adds: { label: string; z: ArmedZone }[] = [
    { label: dict.fenceAddIncPoly, z: { kind: 'polygon', inclusion: true } },
    { label: dict.fenceAddExcPoly, z: { kind: 'polygon', inclusion: false } },
    { label: dict.fenceAddIncCircle, z: { kind: 'circle', inclusion: true } },
    { label: dict.fenceAddExcCircle, z: { kind: 'circle', inclusion: false } },
  ]
  return (
    <aside className="g panel float float-l mission-left" aria-label={dict.fenceTitle}>
      <div className="panel-h" style={{ gap: 6 }}>
        <span className="h1">{dict.fenceTitle}</span>
        <span className="h1 t2" style={{ fontWeight: 300 }}>
          {zones.length}
        </span>
      </div>
      <div className="hair plan-adds">
        {adds.map(({ label, z }) => (
          <button key={label} type="button" className={`btn btn-sm ${z.inclusion ? 'inc' : 'exc'}${armed?.kind === z.kind && armed.inclusion === z.inclusion ? ' on' : ''}`} onClick={() => p.onArm(z)}>
            {label}
          </button>
        ))}
      </div>
      {armed && (
        <div className="hair plan-armed t2">
          <span>{armed.kind === 'polygon' ? dict.fenceArmedPoly : dict.fenceArmedCircle}</span>
          {drawing !== null && (
            <button type="button" className="btn btn-sm btn-primary" onClick={p.onDone}>
              {dict.fenceDone}
            </button>
          )}
        </div>
      )}
      <div className="wp-scroll">
        {zones.length === 0 && <div className="t3" style={{ padding: 16 }}>{dict.fenceEmpty}</div>}
        {zones.map((z, i) => (
          <div key={i} className={`plan-row${z.inclusion ? ' inc' : ' exc'}${drawing === i ? ' sel' : ''}`} data-testid="fence-row">
            <div className="row" style={{ gap: 8 }}>
              <span className="plan-swatch" />
              <span className="fence-title">{zoneTitle(z, dict)}</span>
              <span className="grow" />
              <div className="seg sm" role="group" aria-label={dict.fenceTitle}>
                <span className="lens" style={{ transform: `translateX(${z.inclusion ? 0 : 100}%)` }} />
                <button type="button" className={z.inclusion ? 'on' : ''} onClick={() => p.onInclusion(i, true)}>
                  {dict.fenceInclusion}
                </button>
                <button type="button" className={z.inclusion ? '' : 'on'} onClick={() => p.onInclusion(i, false)}>
                  {dict.fenceExclusion}
                </button>
              </div>
              <button type="button" className="btn-icon sm" aria-label={dict.mDeleteItem} title={dict.mDeleteItem} onClick={() => p.onRemove(i)}>
                <IconClose size={14} />
              </button>
            </div>
            {z.kind === 'circle' && (
              <label className="row t3" style={{ gap: 8, marginTop: 6 }}>
                {dict.fenceRadius}
                <input className="in num" type="number" min={1} step={1} aria-label={dict.fenceRadius} style={{ width: 90 }} value={Math.round(z.radius)} onChange={(e) => e.target.value !== '' && Number.isFinite(Number(e.target.value)) && p.onRadius(i, Number(e.target.value))} />
                m
              </label>
            )}
            {bad.has(i) && <div className="hint caution">{dict.fenceNeedsThree}</div>}
          </div>
        ))}
      </div>
    </aside>
  )
}

interface RallyProps {
  readonly dict: Dict
  readonly points: readonly RallyPoint[]
  readonly onAlt: (index: number, alt: number) => void
  readonly onRemove: (index: number) => void
}

export function RallyPanel(p: RallyProps) {
  const { points, dict } = p
  return (
    <aside className="g panel float float-l mission-left" aria-label={dict.rallyTitle}>
      <div className="panel-h" style={{ gap: 6 }}>
        <span className="h1">{dict.rallyTitle}</span>
        <span className="h1 t2" style={{ fontWeight: 300 }}>
          {points.length}
        </span>
      </div>
      <div className="hair t3" style={{ padding: '8px 16px', fontSize: 12 }}>
        {dict.rallyHint}
      </div>
      <div className="wp-scroll">
        {points.length === 0 && <div className="t3" style={{ padding: 16 }}>{dict.rallyEmpty}</div>}
        {points.map((r, i) => (
          <div key={i} className="plan-row rally" data-testid="rally-row">
            <div className="row" style={{ gap: 8 }}>
              <span className="rg-rally static">R</span>
              <span className="num">{`R${i + 1}`}</span>
              <span className="t3 num">{`${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}`}</span>
              <span className="grow" />
              <button type="button" className="btn-icon sm" aria-label={dict.mDeleteItem} title={dict.mDeleteItem} onClick={() => p.onRemove(i)}>
                <IconClose size={14} />
              </button>
            </div>
            <label className="row t3" style={{ gap: 8, marginTop: 6 }}>
              {dict.altitude}
              <input className="in num" type="number" step={1} aria-label={dict.altitude} style={{ width: 90 }} value={r.alt} onChange={(e) => e.target.value !== '' && Number.isFinite(Number(e.target.value)) && p.onAlt(i, Number(e.target.value))} />
              m Rel
            </label>
          </div>
        ))}
      </div>
    </aside>
  )
}
