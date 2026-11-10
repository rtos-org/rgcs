import { useMemo, useState } from 'react'
import type { Dict } from '../../shared/i18n'
import { IconClose, IconElevation } from '../../shared/ui/icons'
import { TerrainSampler, type DemEncoding } from '../map/terrain'
import { CMDS } from './cmds'
import { elevProfile, type ProfilePoint } from './elevProfile'
import { cmdKey, type Draft } from './model'

const STORE_KEY = 'rgcs.elevOpen'
/** Prototype ELEV_PANEL_H. */
export const ELEV_PANEL_H = 200

const fmtM = (m: number) => `${Math.round(m)} m`
const fmtD = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`)

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) === '1'
  } catch {
    return false
  }
}

function saveOpen(open: boolean): void {
  try {
    localStorage.setItem(STORE_KEY, open ? '1' : '0')
  } catch {
    // per-viewer convenience only
  }
}

interface Props {
  readonly draft: Draft
  readonly selected: ReadonlySet<number>
  readonly terrainTiles: string | null
  readonly terrainEncoding?: DemEncoding
  /** FENCE_ALT_MAX (m above home), drawn as a line; null = none. */
  readonly ceiling?: number | null
  readonly dict: Dict
  readonly onSelect: (uid: number, additive: boolean, range: boolean) => void
}

/** Elevation profile (prototype elevation sheet): toggled by a map button, floats over the map bottom. */
export function ElevationSheet({ draft, selected, terrainTiles, terrainEncoding = 'terrarium', ceiling = null, dict, onSelect }: Props) {
  const [open, setOpen] = useState(readOpen)
  const [tick, setTick] = useState(0)
  // The DEM is fetched only while the sheet is open (2D otherwise needs no tiles).
  const sampler = useMemo(() => (open && terrainTiles ? new TerrainSampler(terrainTiles, () => setTick((n) => n + 1), undefined, undefined, terrainEncoding) : null), [open, terrainTiles, terrainEncoding])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const profile = useMemo(() => (open ? elevProfile(draft, sampler ? sampler.elevAt : () => null, ceiling) : null), [open, draft, sampler, tick, ceiling])
  const toggle = () => {
    saveOpen(!open)
    setOpen(!open)
  }
  const label = (p: ProfilePoint) => {
    const it = draft.items.find((x) => x.uid === p.uid)
    const name = it ? (CMDS[cmdKey(it)]?.mav ?? cmdKey(it)).replace('MAV_CMD_NAV_', '') : ''
    return `#${p.seq} ${name} · ${fmtM(p.rel)} Rel · ${dict.elevAgl} ${fmtM(p.agl)} · ${fmtD(p.d)}`
  }
  return (
    <>
      <button type="button" className={`g-ctl ctl float map-r${open ? ' on' : ''}`} title={dict.elevProfile} aria-label={dict.elevProfile} aria-pressed={open} style={{ bottom: open ? ELEV_PANEL_H + 72 : 60, zIndex: 3 }} onClick={toggle}>
        <IconElevation size={22} />
      </button>
      {open && (
        <div className="g float map-l map-r elev-sheet" role="region" aria-label={dict.elevProfile} style={{ bottom: 60, height: ELEV_PANEL_H, display: 'flex', flexDirection: 'column', zIndex: 3 }}>
          <div className="row" style={{ gap: 12, padding: '10px 16px 2px', fontSize: 12 }}>
            <span className="h2" style={{ whiteSpace: 'nowrap' }}>
              {dict.elevProfile}
            </span>
            <span className="t3">{profile?.hasDem ? dict.elevTerrainOk : dict.elevTerrainNone}</span>
            {profile?.belowGround && <span className="hint caution">{dict.elevBelowGround}</span>}
            <div className="grow" />
            <span className="row t3" style={{ gap: 6 }}>
              <span style={{ width: 14, height: 8, background: 'rgba(140,160,130,.45)', borderTop: '1.5px solid #b7c9a8' }} />
              {dict.elevGround}
            </span>
            <span className="row t3" style={{ gap: 6 }}>
              <span style={{ width: 14, height: 2.5, background: 'var(--accent)' }} />
              {dict.elevFlight}
            </span>
            <button type="button" className="btn-icon sm" aria-label={dict.close} onClick={toggle}>
              <IconClose size={16} />
            </button>
          </div>
          {profile ? <Chart profile={profile} selected={selected} label={label} ceilingLabel={dict.elevCeiling} onSelect={onSelect} /> : <div className="t3" style={{ padding: '24px 16px' }}>{dict.elevEmpty}</div>}
        </div>
      )}
    </>
  )
}

interface ChartProps {
  readonly profile: NonNullable<ReturnType<typeof elevProfile>>
  readonly selected: ReadonlySet<number>
  readonly label: (p: ProfilePoint) => string
  readonly ceilingLabel: string
  readonly onSelect: Props['onSelect']
}

function Chart({ profile, selected, label, ceilingLabel, onSelect }: ChartProps) {
  return (
    <div style={{ flex: 1, position: 'relative', margin: '4px 16px 8px 60px', minHeight: 0 }}>
      <div className="mono num t3" style={{ position: 'absolute', left: -50, top: -2, fontSize: 10, textAlign: 'right', width: 44 }}>
        {fmtM(profile.yMax)}
      </div>
      <div className="mono num t3" style={{ position: 'absolute', left: -50, bottom: 12, fontSize: 10, textAlign: 'right', width: 44 }}>
        {fmtM(profile.yMin)}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 14, borderLeft: '1px solid var(--line-hi)', borderBottom: '1px solid var(--line-hi)' }}>
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}>
          <path d={profile.groundD} fill="rgba(140,160,130,.3)" stroke="#b7c9a8" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
          <path d={profile.postsD} fill="none" stroke="rgba(156,201,255,.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />
          <path d={profile.pathD} fill="none" stroke="var(--accent)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          {profile.ceilingY !== null && <path d={`M0,${profile.ceilingY} L1000,${profile.ceilingY}`} stroke="var(--danger)" strokeWidth={1.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />}
        </svg>
        {profile.ceiling !== null && profile.ceilingY !== null && (
          <span className="mono num elev-ceiling" style={{ top: `${profile.ceilingY}%` }}>{`${ceilingLabel} ${fmtM(profile.ceiling)}`}</span>
        )}
        {profile.points.map((p) => (
          <div
            key={p.uid}
            className={`rg-elev-pt${selected.has(p.uid) ? ' sel' : ''}`}
            style={{ left: `${p.x}%`, top: `${p.y}%`, background: p.agl < 0 ? 'var(--danger)' : selected.has(p.uid) ? 'var(--caution)' : 'var(--accent)' }}
            onClick={(e) => {
              e.stopPropagation()
              onSelect(p.uid, e.metaKey || e.ctrlKey, e.shiftKey)
            }}
          >
            <span className="tip">{label(p)}</span>
          </div>
        ))}
      </div>
      <div className="mono num t3" style={{ position: 'absolute', left: 0, bottom: 0, fontSize: 10 }}>
        0 m
      </div>
      <div className="mono num t3" style={{ position: 'absolute', right: 0, bottom: 0, fontSize: 10 }}>
        {fmtD(profile.total)}
      </div>
    </div>
  )
}
