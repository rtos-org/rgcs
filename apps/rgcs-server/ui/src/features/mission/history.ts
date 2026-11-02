// Undo / redo over immutable snapshots (60 steps).
export const HISTORY_DEPTH = 60

export interface History<T> {
  readonly past: readonly T[]
  readonly present: T
  readonly future: readonly T[]
}

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

/** Records `next` as the present; drops the oldest snapshot past the depth and clears redo. */
export function push<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h
  const past = [...h.past, h.present]
  return { past: past.length > HISTORY_DEPTH ? past.slice(past.length - HISTORY_DEPTH) : past, present: next, future: [] }
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1]
  if (prev === undefined) return h
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] }
}

export function redo<T>(h: History<T>): History<T> {
  const [next, ...rest] = h.future
  if (next === undefined) return h
  return { past: [...h.past, h.present], present: next, future: rest }
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0
