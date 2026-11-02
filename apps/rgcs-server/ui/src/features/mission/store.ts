// Editor UI state: the draft history, selection, tool and I/O status. Pure transitions + one store.
import { useSyncExternalStore } from 'react'
import type { Finding, Mission, MissionItem, UploadReport } from '../../shared/api/types'
import { canRedo, canUndo, initHistory, push, redo, undo, type History } from './history'
import { insertAnchor, reconcileSurveys, removeWithSurveys } from '../survey/draftOps'
import { emptyDraft, fromMission, insertItemsAfter, remapJumps, type Draft } from './model'

export type Tool = 'select' | 'add'
export type Busy = 'idle' | 'saving' | 'uploading' | 'downloading'

export interface MissionUi {
  readonly history: History<Draft>
  readonly selected: ReadonlySet<number>
  /** The uid the last plain or ⌘/Ctrl click landed on: the anchor for Shift range selection. */
  readonly anchor: number | null
  readonly tool: Tool
  readonly savedId: number | null
  readonly dirty: boolean
  readonly busy: Busy
  readonly findings: readonly Finding[]
  readonly lastReport: UploadReport | null
  /** ⌘/Ctrl+C: copies of the selected items in list order (kept across missions). */
  readonly clipboard: readonly MissionItem[]
  /** The uids the clipboard was copied from (a pasted DO_JUMP follows its copied target). */
  readonly clipboardUids: readonly number[]
  /** Names of the surveys the last edit detached (it changed their items); the next edit clears it. */
  readonly surveyNotice: readonly string[]
}

const NO_NOTICE: readonly string[] = []

export const INITIAL_MISSION_UI: MissionUi = {
  history: initHistory(emptyDraft()),
  selected: new Set(),
  anchor: null,
  tool: 'add',
  savedId: null,
  dirty: false,
  busy: 'idle',
  findings: [],
  lastReport: null,
  clipboard: [],
  clipboardUids: [],
  surveyNotice: NO_NOTICE,
}

const EMPTY: ReadonlySet<number> = new Set()

function prune(selected: ReadonlySet<number>, draft: Draft): ReadonlySet<number> {
  const alive = new Set(draft.items.map((it) => it.uid))
  const kept = [...selected].filter((uid) => alive.has(uid))
  return kept.length === selected.size ? selected : new Set(kept)
}

/**
 * Prunes the selection; when it lay inside one survey whose items were all replaced (regenerated,
 * or swapped by undo / redo), the survey stays selected through its first item so its panel stays open.
 */
function reselect(selected: ReadonlySet<number>, prev: Draft, next: Draft): ReadonlySet<number> {
  const kept = prune(selected, next)
  if (kept.size > 0 || selected.size === 0) return kept
  const host = prev.surveys.find((s) => [...selected].every((uid) => s.uids.includes(uid)))
  const first = host && next.surveys.find((s) => s.id === host.id)?.uids[0]
  return first === undefined ? kept : new Set([first])
}

/** Pushes `next` after dropping the surveys it touched outside the survey ops (named in `surveyNotice`). */
const commit = (ui: MissionUi, next: Draft): MissionUi => {
  if (next === ui.history.present) return ui
  const { draft, dropped } = reconcileSurveys(ui.history.present, next)
  const surveyNotice = dropped.length > 0 ? dropped : NO_NOTICE
  return { ...ui, history: push(ui.history, draft), dirty: true, selected: reselect(ui.selected, ui.history.present, draft), findings: [], surveyNotice }
}

/** Records an edit: new present (DO_JUMPs kept on their targets), redo cleared, mission dirty. */
export const edit = (ui: MissionUi, next: Draft): MissionUi => (next === ui.history.present ? ui : commit(ui, remapJumps(ui.history.present, next)))

export const undoUi = (ui: MissionUi): MissionUi => {
  if (!canUndo(ui.history)) return ui
  const history = undo(ui.history)
  return { ...ui, history, dirty: true, selected: reselect(ui.selected, ui.history.present, history.present), surveyNotice: NO_NOTICE }
}

export const redoUi = (ui: MissionUi): MissionUi => {
  if (!canRedo(ui.history)) return ui
  const history = redo(ui.history)
  return { ...ui, history, dirty: true, selected: reselect(ui.selected, ui.history.present, history.present), surveyNotice: NO_NOTICE }
}

/** Plain click = only this one; ⌘/Ctrl (additive) toggles it. Both move the anchor. */
export function selectOne(ui: MissionUi, uid: number, additive: boolean): MissionUi {
  if (!additive) return { ...ui, selected: new Set([uid]), anchor: uid }
  const next = new Set(ui.selected)
  if (next.has(uid)) next.delete(uid)
  else next.add(uid)
  return { ...ui, selected: next, anchor: uid }
}

/** Shift click: adds every item between the anchor and `uid` in list order (the rest stays selected). */
export function selectRange(ui: MissionUi, uid: number): MissionUi {
  const items = ui.history.present.items
  const to = items.findIndex((it) => it.uid === uid)
  const from = ui.anchor === null ? -1 : items.findIndex((it) => it.uid === ui.anchor)
  if (to < 0 || from < 0) return selectOne(ui, uid, false)
  const [a, b] = from < to ? [from, to] : [to, from]
  const range = items.slice(a, b + 1).map((it) => it.uid)
  return { ...ui, selected: new Set([...ui.selected, ...range]) }
}

/** Map Shift-drag box: adds the boxed items (existing ones only); the anchor stays. */
export function addToSelection(ui: MissionUi, uids: readonly number[]): MissionUi {
  const alive = new Set(ui.history.present.items.map((it) => it.uid))
  const next = new Set([...ui.selected, ...uids.filter((u) => alive.has(u))])
  return next.size === ui.selected.size ? ui : { ...ui, selected: next }
}

export function copySelected(ui: MissionUi): MissionUi {
  if (ui.selected.size === 0) return ui
  const picked = ui.history.present.items.filter((it) => ui.selected.has(it.uid))
  return { ...ui, clipboard: picked.map(({ uid: _uid, ...it }) => it), clipboardUids: picked.map((it) => it.uid) }
}

/** ⌘/Ctrl+V: the clipboard after the last selected item (or at the end), one undo step, the copies selected. */
export function pasteClipboard(ui: MissionUi): MissionUi {
  if (ui.clipboard.length === 0) return ui
  const d = ui.history.present
  const last = [...d.items].reverse().find((it) => ui.selected.has(it.uid))
  // with a survey item selected the paste lands after the whole survey
  const { draft, uids } = insertItemsAfter(d, insertAnchor(d, last?.uid ?? null), ui.clipboard)
  const alias = new Map(ui.clipboardUids.map((from, i) => [from, uids[i]!]))
  return { ...commit(ui, remapJumps(d, draft, alias, new Set(uids))), selected: new Set(uids), anchor: uids.at(-1) ?? ui.anchor }
}

/** Hides the survey detach notice (the detach stays; ⌘Z still undoes it). */
export const dismissNotice = (ui: MissionUi): MissionUi => (ui.surveyNotice.length === 0 ? ui : { ...ui, surveyNotice: NO_NOTICE })
export const clearSelection = (ui: MissionUi): MissionUi => (ui.selected.size === 0 ? ui : { ...ui, selected: EMPTY, anchor: null })
export const setTool = (ui: MissionUi, tool: Tool): MissionUi => (ui.tool === tool ? ui : { ...ui, tool })
/** Delete / Backspace: a selected survey item takes its whole survey along (one undo step). */
export const removeSelected = (ui: MissionUi): MissionUi => (ui.selected.size === 0 ? ui : edit(ui, removeWithSurveys(ui.history.present, ui.selected)))

/** Replaces the draft with a mission from the store / vehicle / file; history starts over. */
export const loaded = (ui: MissionUi, m: Mission, savedId: number | null): MissionUi => ({
  ...ui,
  history: initHistory(fromMission(m)),
  selected: EMPTY,
  anchor: null,
  savedId,
  dirty: false,
  findings: [],
  lastReport: null,
  surveyNotice: NO_NOTICE,
})

export const fresh = (ui: MissionUi): MissionUi => ({ ...ui, history: initHistory(emptyDraft()), selected: EMPTY, anchor: null, savedId: null, dirty: false, findings: [], lastReport: null, surveyNotice: NO_NOTICE })
export const markSaved = (ui: MissionUi, id: number): MissionUi => ({ ...ui, savedId: id, dirty: false })
/** `ui` still edits the mission `draft` was a state of (it is its present, or in its undo / redo history). */
export const holdsDraft = (ui: MissionUi, draft: Draft): boolean =>
  ui.history.present === draft || ui.history.past.includes(draft) || ui.history.future.includes(draft)
export const setBusy = (ui: MissionUi, busy: Busy): MissionUi => (ui.busy === busy ? ui : { ...ui, busy })
export const setFindings = (ui: MissionUi, findings: readonly Finding[]): MissionUi => ({ ...ui, findings })
export const setReport = (ui: MissionUi, lastReport: UploadReport | null): MissionUi => ({ ...ui, lastReport })

export class MissionStore {
  private state: MissionUi = INITIAL_MISSION_UI
  private readonly listeners = new Set<() => void>()

  getState = (): MissionUi => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  update(fn: (ui: MissionUi) => MissionUi): void {
    const next = fn(this.state)
    if (next === this.state) return
    this.state = next
    this.listeners.forEach((l) => l())
  }
}

export const missionStore = new MissionStore()

export function useMissionUi(store: MissionStore = missionStore): MissionUi {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
