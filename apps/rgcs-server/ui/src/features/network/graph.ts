// Topology → the drawable graph. Element ids:
// 'server', 'link:<id>', 'v:<sysid>', 'r:<sysid>' (MAVLink dot), 'e:v:<sysid>' (vehicle → server edge),
// 'ws' (WS pill), 'c:<id>' (client), 'e:c:<id>', 'media', and the placeholders 'ph:hub', 'ph:lte:<sysid>' |
// 'ph:lte', 'e:ph:lte:<sysid>' | 'e:ph:lte', 'ph:gw', 'ph:uplink', 'e:ph:uplink', 'ph:users', 'e:ph:users',
// 'ph:ntrip', 'e:ph:ntrip'.
import type { Dict } from '../../shared/i18n'
import type { ClientSession, ComponentKind, MavLinkInfo, MediaServer, NetVehicle, NetworkTopology, ServerNode } from '../../shared/api/types'

export type NetStatus = 'ok' | 'warn'

export interface NetGraph {
  readonly vehicles: readonly NetVehicle[]
  readonly clients: readonly ClientSession[]
  readonly link: MavLinkInfo | null
  readonly status: ReadonlyMap<string, NetStatus>
  readonly warnCount: number
  readonly server: ServerNode
  readonly media: MediaServer
}

/** Loss above this is a warning (80 §3). */
export const LOSS_WARN_PCT = 3

const SHORT: Readonly<Record<ComponentKind, string>> = { autopilot: 'AP', camera: 'CAM', gimbal: 'GMB', companion: 'CC', gcs: 'GCS', other: 'OTH' }

export function componentLabel(kind: ComponentKind): string {
  return SHORT[kind]
}

export function vehicleStatus(v: NetVehicle): NetStatus {
  return v.link === 'ok' ? 'ok' : 'warn'
}

/** A down link, a connected one with no frame for > 3 s (`stale`, 80 §3) or loss above 3 % warns. */
export function linkStatus(l: MavLinkInfo): NetStatus {
  return !l.connected || l.stale || l.loss_pct > LOSS_WARN_PCT ? 'warn' : 'ok'
}

const MAX_URL = 18
const shortUrl = (s: string): string => (s.length > MAX_URL ? `${s.slice(0, MAX_URL - 1)}…` : s)

/** The link pill's value: 「受信なし」 while connected but silent, else the (shortened) url. */
export function linkPillValue(l: MavLinkInfo, dict: Dict): string {
  return l.connected && l.stale ? dict.netNoData : shortUrl(l.url)
}

export function mediaStatus(m: MediaServer): NetStatus {
  return m.reachable === false ? 'warn' : 'ok'
}

/** Vehicle block line 2: `FC · AP 1 · CAM 100 · GMB 154`, or `FC · —` before any frame. */
export function compLine(v: NetVehicle): string {
  const parts = [...v.components].sort((a, b) => a.compid - b.compid).map((c) => `${SHORT[c.kind]} ${c.compid}`)
  return parts.length === 0 ? 'FC · —' : ['FC', ...parts].join(' · ')
}

const KIND_KEY: Readonly<Record<ComponentKind, keyof Dict>> = { autopilot: 'netKindAutopilot', camera: 'netKindCamera', gimbal: 'netKindGimbal', companion: 'netKindCompanion', gcs: 'netKindGcs', other: 'netKindOther' }

/** compLine spelled out for its hover title: 「フライトコントローラー: オートパイロット (コンポーネント 1) · …」. */
export function compTitle(v: NetVehicle, dict: Dict): string {
  const parts = [...v.components].sort((a, b) => a.compid - b.compid).map((c) => dict.netCompTitle.replace('{kind}', dict[KIND_KEY[c.kind]]).replace('{id}', String(c.compid)))
  return `${dict.netFc}: ${parts.join(' · ') || '—'}`
}

/** Vehicle block line 3: the camera link (there is no rgcs-node on a standalone server). */
export function cameraLine(v: NetVehicle, dict: Dict): { readonly text: string; readonly warn: boolean } {
  const cam = v.camera
  if (cam === null || cam.kind === 'none') return { text: dict.netNoCamera, warn: false }
  if (cam.kind === 'mavlink') {
    const compid = /compid (\d+)/.exec(cam.endpoint)?.[1]
    const tail = compid === undefined ? [] : [`CAM ${compid}`]
    return { text: [dict.netMavCamera, dict.netViaFc, ...tail].join(' · '), warn: false }
  }
  return { text: `MT11 · ${cam.endpoint} · ${cam.connected ? dict.netConnected : dict.netDisconnected}`, warn: !cam.connected }
}

export function toGraph(t: NetworkTopology): NetGraph {
  const vehicles = [...t.vehicles].sort((a, b) => a.sysid - b.sysid)
  const entries: readonly (readonly [string, NetStatus])[] = [
    ...vehicles.map((v) => [`v:${v.sysid}`, vehicleStatus(v)] as const),
    ...t.links.map((l) => [`link:${l.id}`, linkStatus(l)] as const),
    ['media', mediaStatus(t.media)],
  ]
  const status = new Map(entries)
  const warnCount = entries.filter(([, s]) => s === 'warn').length
  return { vehicles, clients: t.clients, link: t.links[0] ?? null, status, warnCount, server: t.server, media: t.media }
}

/** `1 リンク · 2 機体 · 1 警告 · 3 クライアント` (10 §8 summary). */
export function graphSummary(g: NetGraph, dict: Dict): string {
  return dict.netSummary
    .replace('{links}', String(g.link === null ? 0 : 1))
    .replace('{vehicles}', String(g.vehicles.length))
    .replace('{warn}', String(g.warnCount))
    .replace('{clients}', String(g.clients.length))
}
