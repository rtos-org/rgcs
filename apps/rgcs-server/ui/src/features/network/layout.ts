// World layout, a port of the prototype's `netLayout` for the one standalone site.
import type { NetGraph } from './graph'

export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface NetLayout {
  readonly pos: ReadonlyMap<number, readonly [number, number]>
  readonly cols: number
  readonly rows: number
  readonly vx: number
  readonly gwY: number
  readonly zone: Rect
  readonly W: number
  readonly H: number
  readonly S: number
  readonly IX: number
  readonly IW: number
  readonly HX: number
  readonly HW: number
  readonly HH: number
  readonly HY: number
  readonly UX: number
}

export const RH = 77, CWD = 306, VW = 236, VH = 70
/** Rows per vehicle column (10 §8: an 8-row grid for 9+ vehicles). */
export const MAX_ROWS = 8
/** First vehicle row; client cards are 58 px apart. */
const Y0 = 62, CLIENT_STEP = 58
/** The 「メッシュ GW · 未構成」 card below the clients. */
const GW_PLACEHOLDER_H = 70
const HUB_Y = 182
/** Space between the last vehicle row and the server card, so the MAVLink link pill sits on the
 *  edges above the card instead of overlapping it (the prototype leaves 6 px; its GW has no pill). */
const GW_GAP = 34

/** Centre line of the `MAVLink · <url>` link pill, between the vehicles and the server card. */
export const linkPillY = (l: NetLayout): number => l.gwY - 20

/** The 映像 (MediaMTX) pill, just right of the server card (`[vx − 110, gwY]`, 220 wide) so it
 *  never covers the card's `<listen> · スタンドアロン` subtitle. */
export const MEDIA_PILL_W = 112
export const mediaPillX = (l: NetLayout): number => l.vx + 116

/** Zone heading size: the LOD-scaled size, shrunk so the label fits inside the zone (the internet
 *  column of one small site is only ~130 wide). Full-width glyphs count 1 em, others 0.6 em. */
export function zoneLabelFs(label: string, w: number, fs: number): number {
  const ems = [...label].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0xff ? 1 : 0.6), 0)
  return ems === 0 ? fs : Math.min(fs, (w - 32) / ems)
}

/** Top of the client column (the first client card). */
export const clientsY = (l: NetLayout): number => l.gwY + 92
export const clientY = (l: NetLayout, i: number): number => clientsY(l) + i * CLIENT_STEP
/** The 「メッシュ GW · 未構成」 card, below the last client slot. */
export const gatewayY = (l: NetLayout, clients: number): number => clientsY(l) + Math.max(1, clients) * CLIENT_STEP + 4

export function layoutNetwork(g: NetGraph): NetLayout {
  const n = g.vehicles.length
  const rows = Math.max(1, Math.min(MAX_ROWS, n))
  const cols = Math.max(1, Math.ceil(n / MAX_ROWS))
  const vx = cols === 1 ? 176 : 150
  const pos = new Map(g.vehicles.map((v, j) => [v.sysid, [vx + Math.floor(j / MAX_ROWS) * CWD, Y0 + (j % MAX_ROWS) * RH] as const]))
  const extraClients = Math.max(0, g.clients.length - 1) * CLIENT_STEP
  const zone = { x: 8, y: Y0 - 44, w: vx + (cols - 1) * CWD + VW + 12, h: rows * RH + 192 + (GW_GAP - 6) + extraClients + GW_PLACEHOLDER_H }
  const siteBottom = zone.y + zone.h
  const S = Math.min(3, Math.max(1, siteBottom / 700))
  const fieldR = zone.x + zone.w
  const IX = fieldR + 30 + 148 * S, IW = 110 * S, HX = IX + IW + 50 * S, HW = 176 * S, HH = 200 * S
  const UX = HX + HW + 66 * S
  // Deviation from netLayout: one small site would leave the hub below the world, so H also holds it.
  const H = Math.max(siteBottom, HUB_Y + HH + 26)
  return { pos, cols, rows, vx, gwY: Y0 + rows * RH + GW_GAP, zone, W: UX + 190 * S, H, S, IX, IW, HX, HW, HH, HY: HUB_Y, UX }
}
