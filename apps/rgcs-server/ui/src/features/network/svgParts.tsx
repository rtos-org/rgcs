// SVG renderers for the network canvas, a port of the prototype's `netKit`, `netZone`, `netCard` and
// `netVehicle`. Every element carries `data-id`; selection adds `sel`, and anything outside the
// selection's relations gets `dim`.
import type { ComponentType, ReactElement, ReactNode } from 'react'
import type { Dict } from '../../shared/i18n'
import type { NetVehicle, VehicleKind } from '../../shared/api/types'
import { IconCamera, IconCopter, IconPlane, IconRover } from '../../shared/ui/icons'
import { cameraLine, compLine, compTitle, type NetStatus } from './graph'
import { zoneLabelFs } from './layout'
import type { Lod } from './viewport'

export interface Kit {
  readonly sel: string
  readonly rel: ReadonlySet<string> | null
}

export type IconComp = ComponentType<{ readonly size?: number; readonly className?: string }>
export type PillState = 'ok' | 'warn' | 'rtc' | 'idle' | 'ph'

const STATUS_COLOR: Readonly<Record<NetStatus, string>> = { ok: '#5fd39b', warn: '#f2b544' }
const PILL_DOT: Readonly<Record<PillState, string>> = { ok: '#5fd39b', warn: '#f2b544', rtc: '#d8a8ff', idle: '#8b95a5', ph: '#8b95a5' }
const VEHICLE_ICON: Readonly<Record<VehicleKind, IconComp>> = { copter: IconCopter, rover: IconRover, plane: IconPlane, other: IconCopter }

const dim = (k: Kit, id: string): string => (k.rel === null || k.rel.has(id) ? '' : ' dim')
const sel = (k: Kit, id: string): string => (k.sel === id ? ' sel' : '')

/** A Lucide icon placed in world units (the inner icon draws on its own 24 grid). */
export function SvgIcon({ icon: Icon, x, y, size, color }: { readonly icon: IconComp; readonly x: number; readonly y: number; readonly size: number; readonly color?: string }) {
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24" overflow="visible" style={color === undefined ? undefined : { color }}>
      <Icon size={24} />
    </svg>
  )
}

export function Edge({ kit, id, cls, d }: { readonly kit: Kit; readonly id: string; readonly cls: string; readonly d: string }) {
  return (
    <g className={`ne ${cls}${dim(kit, id)}`} data-id={id}>
      <path className="hit" d={d} />
      <path className="base" d={d} />
      <path className="flow" d={d} />
    </g>
  )
}

export function Node({ kit, id, extra = '', children }: { readonly kit: Kit; readonly id: string; readonly extra?: string; readonly children: ReactNode }) {
  return (
    <g className={`nn${sel(kit, id)}${extra}${dim(kit, id)}`} data-id={id}>
      {children}
    </g>
  )
}

export function Zone({ x, y, w, h, label, tone = '', fs = 11 }: { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly label: string; readonly tone?: string; readonly fs?: number }) {
  const size = zoneLabelFs(label, w, fs)
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={18} className={`nzone ${tone}`.trim()} />
      <text className="ncolh" x={x + 16} y={y + 12 + size} style={{ fontSize: `${size}px` }}>
        {label}
      </text>
    </g>
  )
}

interface CardProps {
  readonly kit: Kit
  readonly id: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly icon: IconComp
  readonly title: string
  readonly sub: string
  readonly extra?: string
}

/** A titled card; compact cards (h < 56) put the subtitle beside the icon. */
export function Card({ kit, id, x, y, w, h, icon, title, sub, extra = '' }: CardProps) {
  const s = h < 56
  return (
    <Node kit={kit} id={id} extra={extra}>
      <rect className="card" x={x} y={y} width={w} height={h} rx={12} />
      <SvgIcon icon={icon} x={x + 13} y={s ? y + (h - 18) / 2 : y + 14} size={18} />
      <text x={x + 40} y={s ? y + 21 : y + 28} fontSize={13.5} fontWeight={600}>
        {title}
      </text>
      <text x={s ? x + 40 : x + 14} y={s ? y + 38 : y + h - 13} fontSize={11} className="t3">
        {sub}
      </text>
    </Node>
  )
}

interface PillProps {
  readonly kit: Kit
  readonly id: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly label: string
  readonly val?: string
  readonly state: PillState
  readonly sc?: number
}

/** A link pill, drawn in local units and scaled so it stays legible in a large world. */
export function Pill({ kit, id, x, y, w, label, val = '', state, sc = 1 }: PillProps) {
  const cls = `npl${state === 'warn' ? ' warn' : ''}${state === 'rtc' ? ' rtc' : ''}${state === 'ph' ? ' ph' : ''}${sel(kit, id)}${dim(kit, id)}`
  return (
    <g className={cls} data-id={id} transform={`translate(${x},${y}) scale(${sc})`}>
      <rect x={0} y={-10} width={w} height={20} rx={10} />
      <circle cx={12} cy={0} r={3.5} fill={PILL_DOT[state]} />
      <text x={22} y={3.5}>
        {label}
      </text>
      {val !== '' && (
        <text x={w - 9} y={3.5} textAnchor="end" className="ntx2 nmono">
          {val}
        </text>
      )}
    </g>
  )
}

interface VehicleProps {
  readonly kit: Kit
  readonly v: NetVehicle
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly lod: Lod
  readonly status: NetStatus
  readonly dict: Dict
}

/** A vehicle block (FC + its camera link); detail drops with zoom: full → compact → site tile. */
export function VehicleBlock(p: VehicleProps): ReactElement {
  const { kit, v, x, y, w, h, lod, status } = p
  const id = `v:${v.sysid}`
  const col = STATUS_COLOR[status]
  const warn = status === 'warn' ? ' warn' : ''
  if (lod === 'site') {
    return (
      <Node kit={kit} id={id}>
        <rect x={x} y={y} width={w} height={h} rx={14} fill={col} fillOpacity={0.55} stroke={col} />
      </Node>
    )
  }
  if (lod === 'compact') {
    return (
      <Node kit={kit} id={id} extra={warn}>
        <rect className="card" x={x} y={y} width={w} height={h} rx={14} />
        <circle cx={x + 26} cy={y + h / 2} r={10} fill={col} />
        <text x={x + 48} y={y + h / 2 + 10} fontSize={28} fontWeight={600}>
          {v.name}
        </text>
      </Node>
    )
  }
  return <VehicleFull {...p} />
}

function VehicleFull({ kit, v, x, y, w, h, dict, status }: VehicleProps) {
  const cam = cameraLine(v, dict)
  return (
    <Node kit={kit} id={`v:${v.sysid}`} extra={status === 'warn' ? ' warn' : ''}>
      <rect className="card" x={x} y={y} width={w} height={h} rx={14} />
      <SvgIcon icon={VEHICLE_ICON[v.kind]} x={x + 14} y={y + 13} size={18} />
      <text x={x + 41} y={y + 27} fontSize={14} fontWeight={600}>
        {v.name}
        {v.link === 'lost' && (
          <tspan fontSize={11} fontWeight={500} style={{ fill: 'var(--caution)' }}>
            {` · ${dict.netLost}`}
          </tspan>
        )}
      </text>
      <rect x={x + w - 74} y={y + 11} width={62} height={20} rx={6} fill="rgba(156,201,255,.14)" stroke="rgba(156,201,255,.45)" />
      <text x={x + w - 43} y={y + 25} fontSize={11} textAnchor="middle" className="nmono" style={{ fill: 'var(--accent)' }}>
        {`SYSID ${v.sysid}`}
      </text>
      <text x={x + 14} y={y + 47} fontSize={10.5} className="t3 nmono">
        <title>{compTitle(v, dict)}</title>
        {compLine(v)}
      </text>
      <SvgIcon icon={IconCamera} x={x + 14} y={y + 52} size={12} />
      <text x={x + 31} y={y + 62} fontSize={10.5} className="t2" style={cam.warn ? { fill: 'var(--caution)' } : undefined}>
        {cam.text}
      </text>
    </Node>
  )
}
