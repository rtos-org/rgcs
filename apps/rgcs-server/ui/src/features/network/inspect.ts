// Selection → inspector content (prototype `netInspector`), from real data only.
// Unknown or vanished ids fall back to the server; placeholders explain that M5 configures them.
import type { Dict } from '../../shared/i18n'
import type { ClientSession, MavLinkInfo, NetSystem, NetVehicle, NetworkTopology, VehicleKind } from '../../shared/api/types'
import { cameraLine, componentLabel, graphSummary, LOSS_WARN_PCT, toGraph } from './graph'
import { fmtAge, fmtBytes, fmtLoss, fmtRate } from './format'
import { placeholderInspection } from './inspectPlaceholder'

export { fmtAge, fmtBytes, fmtRate } from './format'

export interface KvRow {
  readonly k: string
  readonly v: string
  readonly cls?: 'warn' | 'ok' | 'dim'
}
export interface Cell {
  readonly v: string
  readonly cls?: string
}
export interface Table {
  readonly title: string
  readonly cols: string
  readonly head: readonly string[]
  readonly rows: readonly (readonly Cell[])[]
}
export type InspectIcon = 'server' | 'cable' | 'copter' | 'rover' | 'laptop' | 'router' | 'globe' | 'radio-tower' | 'video'
export interface Inspection {
  readonly icon: InspectIcon
  readonly title: string
  readonly sub: string
  readonly kv: readonly KvRow[]
  readonly tables: readonly Table[]
  readonly note?: string
}

const KIND: Readonly<Record<VehicleKind, string>> = { copter: 'Copter', rover: 'Rover', plane: 'Plane', other: 'Other' }

const kv = (k: string, v: string, cls?: KvRow['cls']): KvRow => (cls === undefined ? { k, v } : { k, v, cls })
const cell = (v: string | number, cls?: string): Cell => (cls === undefined ? { v: String(v) } : { v: String(v), cls })
const lossCls = (pct: number): string => (pct > LOSS_WARN_PCT ? 'warn' : 'mono')

/** `1 リンク · 2 機体 · 1 警告 · 2 クライアント`. */
export function summary(t: NetworkTopology, dict: Dict): string {
  return graphSummary(toGraph(t), dict)
}

function mediaValue(t: NetworkTopology, dict: Dict): KvRow {
  const m = t.media
  if (m.whep_upstream === '') return kv(dict.netMedia, dict.netUnconfigured, 'dim')
  if (m.reachable === null) return kv(dict.netMedia, `${m.whep_upstream} · ${dict.netChecking}`)
  return kv(dict.netMedia, `${m.whep_upstream} · ${m.reachable ? dict.netReachable : dict.netUnreachable}`, m.reachable ? undefined : 'warn')
}

function clientTable(clients: readonly ClientSession[], dict: Dict): Table {
  return {
    title: dict.netClients,
    cols: '1fr 66px 122px 62px',
    head: [dict.netUser, dict.netRole, dict.netAddr, dict.netBrowser],
    rows: clients.map((c) => [cell(c.username), cell(c.role, 'dim'), cell(c.addr ?? '—', 'mono'), cell(c.browser, 'dim')]),
  }
}

function serverInspection(t: NetworkTopology, dict: Dict): Inspection {
  const s = t.server
  return {
    icon: 'server',
    title: 'rgcs-server',
    sub: dict.netServerSub,
    kv: [
      kv(dict.netHostname, s.hostname),
      kv(dict.netVersion, `${s.version} (${s.build})`),
      kv(dict.netListen, s.listen),
      kv(dict.netUptime, fmtAge(s.uptime_s * 1000, dict)),
      mediaValue(t, dict),
    ],
    tables: [clientTable(t.clients, dict)],
  }
}

const linkOf = (t: NetworkTopology, id: string): MavLinkInfo | undefined => t.links.find((l) => l.id === id)

function vehicleState(v: NetVehicle, dict: Dict): KvRow {
  if (v.link === 'ok') return kv(dict.netState, dict.netOk, 'ok')
  return kv(dict.netState, v.link === 'lost' ? dict.netLost : dict.netDelay, 'warn')
}

function videoValue(v: NetVehicle, t: NetworkTopology, dict: Dict): KvRow {
  const p = v.video
  if (p === null || p.source === 'none') return kv(dict.netVideo, dict.netNoVideo, 'dim')
  const probe = p.scanning ? dict.netScanning : p.probe_ok ? 'RTSP OK' : dict.netRtspDown
  const media = t.media.reachable === false ? [`MediaMTX ${dict.netUnreachable}`] : []
  const warn = (!p.scanning && !p.probe_ok) || media.length > 0
  return kv(dict.netVideo, [p.source, probe, p.whep_path, ...media].join(' · '), warn ? 'warn' : undefined)
}

function componentTable(v: NetVehicle, dict: Dict): Table {
  const rows = [...v.components]
    .sort((a, b) => a.compid - b.compid)
    .map((c) => [cell(c.compid, 'mono'), cell(componentLabel(c.kind), 'mono'), cell(fmtRate(c.rx_msgs_per_s), 'mono'), cell(fmtLoss(c.loss_pct), lossCls(c.loss_pct)), cell(fmtAge(c.last_rx_age_ms, dict), 'mono')])
  return { title: dict.netComponents, cols: '68px 46px 1fr 1fr 1fr', head: ['COMPID', dict.netKind, 'msg/s', dict.netLoss, dict.netLastRx], rows }
}

function vehicleInspection(v: NetVehicle, t: NetworkTopology, dict: Dict): Inspection {
  const link = linkOf(t, v.link_id)
  const route = [v.name, `MAVLink (${link?.url ?? v.link_id})`, 'rgcs-server', `${dict.netClients} ${t.clients.length}`].join(' → ')
  const cam = cameraLine(v, dict)
  return {
    icon: v.kind === 'rover' ? 'rover' : 'copter',
    title: v.name,
    sub: `${KIND[v.kind]} · SYSID ${v.sysid}`,
    kv: [
      vehicleState(v, dict),
      kv(dict.netRoute, route, v.link === 'ok' ? undefined : 'warn'),
      kv(dict.netVia, dict.netMavDirect),
      kv(dict.netCloudRoute, dict.netNoHub, 'dim'),
      kv(dict.netHeartbeat, fmtAge(v.heartbeat_age_ms, dict)),
      kv(dict.netNode, dict.netUnconfigured, 'dim'),
      kv(dict.netCamera, cam.text, cam.warn ? 'warn' : undefined),
      videoValue(v, t, dict),
    ],
    tables: [componentTable(v, dict)],
  }
}

function systemKind(s: NetSystem, dict: Dict): string {
  if (s.vehicle) return dict.netVehicleK
  return s.components.map((c) => `${componentLabel(c.kind)} ${c.compid}`).join(' · ') || '—'
}

function systemTable(l: MavLinkInfo, dict: Dict): Table {
  const rows = [...l.systems]
    .sort((a, b) => a.sysid - b.sysid)
    .map((s) => [cell(s.sysid, 'mono'), cell(systemKind(s, dict)), cell(fmtRate(s.components.reduce((n, c) => n + c.rx_msgs_per_s, 0)), 'mono')])
  return { title: dict.netSystems, cols: '64px 1fr 64px', head: ['SYSID', dict.netKind, 'msg/s'], rows }
}

/** 状態: 未接続 / 受信なし (connected but silent > 3 s) warn, else 接続 ok. */
function linkState(l: MavLinkInfo, dict: Dict): KvRow {
  if (!l.connected) return kv(dict.netState, dict.netDisconnected, 'warn')
  return l.stale ? kv(dict.netState, dict.netNoData, 'warn') : kv(dict.netState, dict.netConnected, 'ok')
}

function linkInspection(l: MavLinkInfo, dict: Dict, now: number): Inspection {
  const since = l.connected_since_unix_ms === null ? null : now - l.connected_since_unix_ms
  const err = l.last_error === null ? [] : [kv(dict.netLastError, l.last_error, 'warn')]
  return {
    icon: 'cable',
    title: 'MAVLink',
    sub: l.url,
    kv: [
      kv(dict.netKind, l.kind),
      linkState(l, dict),
      kv(dict.netSince, l.connected ? fmtAge(since, dict) : '—'),
      kv(dict.netRxEst, `${fmtRate(l.rx_msgs_per_s)} msg/s · ${fmtBytes(l.rx_bytes_per_s)}`),
      kv(dict.netLoss, fmtLoss(l.loss_pct), l.loss_pct > LOSS_WARN_PCT ? 'warn' : undefined),
      kv(dict.netReconnects, String(l.reconnects)),
      kv(dict.netLastRx, fmtAge(l.last_rx_age_ms, dict)),
      ...err,
    ],
    tables: [systemTable(l, dict)],
    note: dict.netSeeInspector,
  }
}

function clientInspection(c: ClientSession, dict: Dict, now: number): Inspection {
  return {
    icon: 'laptop',
    title: c.username,
    sub: `${c.role} · ${c.browser}`,
    kv: [kv(dict.netAddr, c.addr ?? '—'), kv(dict.netRole, c.role), kv(dict.netBrowser, c.browser), kv(dict.netSince, fmtAge(now - c.connected_since_unix_ms, dict))],
    tables: [],
  }
}

function mediaInspection(t: NetworkTopology, dict: Dict): Inspection {
  const r = t.media.reachable
  const state = r === null ? kv(dict.netState, dict.netChecking) : r ? kv(dict.netState, dict.netReachable, 'ok') : kv(dict.netState, dict.netUnreachable, 'warn')
  const rows = t.vehicles.map((v) => [cell(v.name), cell(videoValue(v, t, dict).v, 'mono')])
  return {
    icon: 'video',
    title: 'MediaMTX',
    sub: dict.netMedia,
    kv: [kv(dict.netWhep, t.media.whep_upstream || dict.netUnconfigured), state],
    tables: rows.length === 0 ? [] : [{ title: dict.netVideo, cols: '76px 1fr', head: [dict.netVehicleK, dict.netVideo], rows }],
  }
}

function wsInspection(t: NetworkTopology, dict: Dict): Inspection {
  return { icon: 'laptop', title: dict.netWsLocal, sub: dict.netFieldOp, kv: [kv(dict.netClients, String(t.clients.length))], tables: [clientTable(t.clients, dict)] }
}

/** The vehicle (v:/r:/e:v:) or client (c:/e:c:) number an id refers to. */
const idNumber = (sel: string, kinds: readonly string[]): number | null => {
  const prefix = kinds.find((k) => sel.startsWith(k))
  return prefix === undefined ? null : Number(sel.slice(prefix.length))
}

function elementInspection(sel: string, t: NetworkTopology, dict: Dict, now: number): Inspection | null {
  const sysid = idNumber(sel, ['v:', 'r:', 'e:v:'])
  const v = sysid === null ? undefined : t.vehicles.find((x) => x.sysid === sysid)
  if (v !== undefined) return vehicleInspection(v, t, dict)
  const cid = idNumber(sel, ['c:', 'e:c:'])
  const c = cid === null ? undefined : t.clients.find((x) => x.id === cid)
  if (c !== undefined) return clientInspection(c, dict, now)
  const l = sel.startsWith('link:') ? linkOf(t, sel.slice(5)) : undefined
  if (l !== undefined) return linkInspection(l, dict, now)
  if (sel === 'media') return mediaInspection(t, dict)
  if (sel === 'ws') return wsInspection(t, dict)
  return null
}

/** What the inspector shows for `sel`; anything unknown (or gone) shows the server. */
export function inspect(sel: string, t: NetworkTopology, dict: Dict, now: number): Inspection {
  return elementInspection(sel, t, dict, now) ?? placeholderInspection(sel, t, dict) ?? serverInspection(t, dict)
}

/** Whether `sel` still names something in `t` (a vanished selection falls back to the server). */
export function selectionExists(sel: string, t: NetworkTopology, dict: Dict): boolean {
  return sel === 'server' || elementInspection(sel, t, dict, 0) !== null || placeholderInspection(sel, t, dict) !== null
}
