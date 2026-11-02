// Client-side mirror of rgcs-core's `Mission::stats` and the structural warnings (the fence
// checks need the vehicle's parameters and stay on the server: `POST /api/missions/validate`).
import type { Home, MissionItem, MissionStats, VehicleKind } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { hasPosition, isPositional, legDistanceM } from './geo'

export const LONG_FLIGHT_S = 1200

export interface LocalWarning {
  readonly code: 'empty' | 'first_not_takeoff' | 'mixed_frames' | 'terrain_frame' | 'no_land_or_rtl' | 'long_flight' | 'rover_takeoff'
  readonly seq: number | null
}

const WAIT_CMDS = new Set([16, 19, 112])

export function stats(items: readonly MissionItem[], home: Home | null, speed: number): MissionStats {
  let distance = 0
  let waits = 0
  let maxAlt = 0
  let prev: { lat: number; lon: number } | null = home ? { lat: home.lat, lon: home.lon } : null
  for (const it of items) {
    if (hasPosition(it)) {
      if (prev) distance += legDistanceM(prev, it)
      prev = { lat: it.lat, lon: it.lon }
      maxAlt = Math.max(maxAlt, it.alt)
    }
    if (WAIT_CMDS.has(it.command)) waits += Math.max(0, it.params[0])
    else if (it.command === 93 && it.params[0] >= 0) waits += it.params[0]
  }
  return { distance_m: distance, duration_s: distance / Math.max(speed, 0.1) + waits, max_alt: maxAlt }
}

/** A rover drives from its first waypoint: no takeoff, and it may end on a waypoint. */
export function localWarnings(items: readonly MissionItem[], speed: number, kind: VehicleKind | null = null): readonly LocalWarning[] {
  if (items.length === 0) return [{ code: 'empty', seq: null }]
  const ground = kind === 'rover'
  const out: LocalWarning[] = []
  if (!ground && items[0]?.command !== 22 && items[0]?.command !== 84) out.push({ code: 'first_not_takeoff', seq: 1 })
  const takeoff = items.findIndex((it) => it.command === 22 || it.command === 84)
  if (ground && takeoff >= 0) out.push({ code: 'rover_takeoff', seq: takeoff + 1 })
  const frames = new Set(items.filter(isPositional).map((it) => it.frame))
  if (frames.size > 1) out.push({ code: 'mixed_frames', seq: null })
  items.forEach((it, i) => {
    if (isPositional(it) && it.frame === 'ter') out.push({ code: 'terrain_frame', seq: i + 1 })
  })
  const last = items[items.length - 1]
  if (!ground && last && ![20, 21, 85].includes(last.command)) out.push({ code: 'no_land_or_rtl', seq: items.length })
  if (stats(items, null, speed).duration_s > LONG_FLIGHT_S) out.push({ code: 'long_flight', seq: null })
  return out
}

/** The operator-facing text of a validation code (`f_<code>` in the dictionary). */
export function findingText(code: string, dict: Dict): string {
  const key = `f_${code}` as keyof Dict
  return dict[key] ?? code
}
