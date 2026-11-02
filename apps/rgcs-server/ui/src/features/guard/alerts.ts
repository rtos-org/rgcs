// Active AI 緊急介入 alerts as the UI keeps them.
// Entries are stored on the LOCAL clock: `ts` is when this browser received the latest frame and
// `deadline_ms` is the server's remaining time added to it, so a Pi whose clock is off by minutes
// still shows an accurate countdown. Map insertion order = first arrival (newest first = reverse).
import type { GuardAlert, GuardPhase, VehicleState } from '../../shared/api/types'

export type AlertMap = ReadonlyMap<string, GuardAlert>

/** A taken-over alert stays visible (neutral) this long, then goes (not a mode change). */
export const TAKEN_OVER_KEEP_MS = 10_000

// The tone keeps repeating through these phases once an alert has sounded; a cancel (a human
// pressed 取り消し) or a takeover silences it; `unanswered` arrives with `sound: true` again.
const KEEPS_SOUNDING: ReadonlySet<GuardPhase> = new Set(['alerting', 'countdown', 'due', 'executing', 'executed', 'refused', 'unanswered'])

/** A mode change the AI did not make (a pilot's switch or a vehicle failsafe — the server cannot tell
 * which). The AI stands down, but nobody is known to have taken over: it stays, warned, until cleared. */
export function modeChanged(a: GuardAlert): boolean {
  return a.phase === 'taken_over' && a.taken_over_by === 'mode_change'
}

/** A confirmed takeover (sticks or an operator command). */
export function takenOver(a: GuardAlert): boolean {
  return a.phase === 'taken_over' && !modeChanged(a)
}

function rebased(a: GuardAlert, now: number, prev: GuardAlert | undefined): GuardAlert {
  const deadline = a.deadline_ms === null ? null : now + Math.max(0, a.deadline_ms - a.ts)
  const sound = (KEEPS_SOUNDING.has(a.phase) || modeChanged(a)) && (a.sound || (prev?.sound ?? false))
  return { ...a, ts: now, deadline_ms: deadline, sound }
}

/** Drops taken-over alerts older than 10 s; returns the same map when nothing changes. */
export function pruneAlerts(m: AlertMap, now: number): AlertMap {
  const stale = [...m.values()].filter((a) => takenOver(a) && now - a.ts > TAKEN_OVER_KEEP_MS)
  if (stale.length === 0) return m
  return new Map([...m].filter(([id]) => !stale.some((a) => a.id === id)))
}

/** One `guard_alert` frame: replaces the entry by id (keeping its place), drops `cleared`. */
export function applyGuardAlert(m: AlertMap, a: GuardAlert, now: number): AlertMap {
  const base = pruneAlerts(m, now)
  if (a.phase === 'cleared') {
    if (!base.has(a.id)) return base
    return new Map([...base].filter(([id]) => id !== a.id))
  }
  return new Map(base).set(a.id, rebased(a, now, base.get(a.id)))
}

/** `GET /api/guard/alerts` for a fresh (or reconnected) client: the server's list replaces ours. */
export function replaceAlerts(list: readonly GuardAlert[], now: number): AlertMap {
  return list.reduce<AlertMap>((m, a) => applyGuardAlert(m, a, now), new Map())
}

/** Vehicles to highlight: every live alert except a finished takeover. */
export function activeSysids(m: AlertMap): ReadonlySet<number> {
  return new Set([...m.values()].filter((a) => !takenOver(a)).map((a) => a.sysid))
}

/** Alerts whose tone should be repeating, in arrival order. */
export function soundingIds(m: AlertMap): readonly string[] {
  return [...m.values()].filter((a) => a.sound).map((a) => a.id)
}

export function newestFirst(m: AlertMap): readonly GuardAlert[] {
  return [...m.values()].reverse()
}

/** ORs the guard into the vehicles' `warn` flag (map marker and list dot); same map when none. */
export function guardedVehicles<V extends Pick<VehicleState, 'sysid' | 'warn'>>(vehicles: ReadonlyMap<number, V>, active: ReadonlySet<number>): ReadonlyMap<number, V> {
  if (![...active].some((sysid) => vehicles.has(sysid) && !vehicles.get(sysid)!.warn)) return vehicles
  return new Map([...vehicles].map(([sysid, v]) => [sysid, active.has(sysid) && !v.warn ? { ...v, warn: true } : v]))
}
