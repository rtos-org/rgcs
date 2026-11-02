import { INITIAL_MISSION_UI, fresh, type MissionUi } from '../mission/store'
import { nextColor } from './palette'

export { PALETTE } from './palette'

export interface Row {
  readonly key: string
  readonly color: string
  readonly sysid: number | null
  readonly missing: boolean
  /** View-only: a parked row left off the map (never sent to the server). */
  readonly hidden: boolean
  readonly ui: MissionUi
}

export interface Workspace {
  readonly rows: readonly Row[]
  readonly active: string
}

let counter = 0
export const nextKey = (): string => `r${++counter}`

/** Call after restoring rows (e.g. from localStorage) so new keys never collide with them. */
export function reseedKeys(rows: readonly { readonly key: string }[]): void {
  const max = rows.reduce((m, r) => {
    const n = /^r(\d+)$/.exec(r.key)
    return n ? Math.max(m, Number(n[1])) : m
  }, 0)
  counter = Math.max(counter, max)
}

const makeRow = (rows: readonly Row[], ui: MissionUi): Row => ({ key: nextKey(), color: nextColor(rows.map((r) => r.color)), sysid: null, missing: false, hidden: false, ui })

export function emptyWorkspace(): Workspace {
  const row = makeRow([], fresh(INITIAL_MISSION_UI))
  return { rows: [row], active: row.key }
}

export function addRow(ws: Workspace, ui: MissionUi): Workspace {
  const dup = ui.savedId === null ? undefined : ws.rows.find((r) => r.ui.savedId === ui.savedId)
  if (dup) return activate(ws, dup.key)
  const row = makeRow(ws.rows, ui)
  return { ...ws, rows: [...ws.rows, row], active: row.key }
}

export function removeRow(ws: Workspace, key: string): Workspace {
  const i = ws.rows.findIndex((r) => r.key === key)
  if (i < 0) return ws
  const rows = ws.rows.filter((r) => r.key !== key)
  if (rows.length === 0) return withFreshRow(ws)
  const active = ws.active === key ? rows[Math.min(i, rows.length - 1)].key : ws.active
  return showActive({ ...ws, rows, active })
}

/** The active row is always shown: applied wherever `active` is set other than through `activate`. */
export const showActive = (ws: Workspace): Workspace => (activeRow(ws).hidden ? mapRow(ws, activeRow(ws).key, (r) => ({ ...r, hidden: false })) : ws)

function withFreshRow(ws: Workspace): Workspace {
  const e = emptyWorkspace()
  return { ...ws, rows: e.rows, active: e.active }
}

export function moveRow(ws: Workspace, key: string, delta: -1 | 1): Workspace {
  const i = ws.rows.findIndex((r) => r.key === key)
  const j = i + delta
  if (i < 0 || j < 0 || j >= ws.rows.length) return ws
  const rows = ws.rows.slice()
  rows[i] = ws.rows[j]
  rows[j] = ws.rows[i]
  return { ...ws, rows }
}

const mapRow = (ws: Workspace, key: string, f: (r: Row) => Row): Workspace => ({ ...ws, rows: ws.rows.map((r) => (r.key === key ? f(r) : r)) })

export const setColor = (ws: Workspace, key: string, color: string): Workspace => mapRow(ws, key, (r) => ({ ...r, color }))

export function assign(ws: Workspace, key: string, sysid: number | null): Workspace {
  return {
    ...ws,
    rows: ws.rows.map((r) => {
      if (r.key === key) return { ...r, sysid }
      return sysid !== null && r.sysid === sysid ? { ...r, sysid: null } : r
    }),
  }
}

/** A saved plan was deleted: its open rows keep their content as never-saved plans (saving creates a new one). */
export function forgetSaved(ws: Workspace, id: number): Workspace {
  if (!ws.rows.some((r) => r.ui.savedId === id)) return ws
  return { ...ws, rows: ws.rows.map((r) => (r.ui.savedId === id ? { ...r, ui: { ...r.ui, savedId: null, dirty: true } } : r)) }
}

export const parkActive = (ws: Workspace, ui: MissionUi): Workspace => mapRow(ws, ws.active, (r) => ({ ...r, ui }))

/** The active row is always shown, so hiding it is a no-op. */
export const setHidden = (ws: Workspace, key: string, hidden: boolean): Workspace => (ws.active === key ? ws : mapRow(ws, key, (r) => ({ ...r, hidden })))

export function activate(ws: Workspace, key: string): Workspace {
  if (ws.active === key || !ws.rows.some((r) => r.key === key)) return ws
  return { ...mapRow(ws, key, (r) => ({ ...r, hidden: false })), active: key }
}

export const activeRow = (ws: Workspace): Row => ws.rows.find((r) => r.key === ws.active) ?? ws.rows[0]

/** Two or more missions open (missing rows do not count): rows are told apart by colour and assignment. */
export const isMulti = (ws: Workspace): boolean => ws.rows.filter((r) => !r.missing).length > 1

/**
 * Where 機体に書き込む writes (spec 2026-10-20 §8, UX review 2026-10-26): exactly the active row's
 * assignment, null when it is unassigned. No fallback to the mission's own or the first vehicle:
 * the write goes only to the vehicle both selects show.
 */
export const writeTarget = (ws: Workspace): number | null => activeRow(ws).sysid
