// Per-button command feedback (operator proposal 2): the pressed button shows sending, then
// done / failed for a few seconds once the result for that vehicle and command reaches the message log.
import type { LogEntry } from '../../shared/api/types'

export type BtnState = 'sending' | 'ok' | 'fail'

interface Press {
  readonly state: BtnState
  /** The newest matching result when pressed: a different one settles the press. */
  readonly lastId: number | null
  readonly at: number
}

export type Feedback = ReadonlyMap<string, Press>
export const NO_FEEDBACK: Feedback = new Map()

const SHOW_MS = 4000
const GIVE_UP_MS = 15_000
const key = (sysid: number, cmd: string) => `${sysid}:${cmd}`

/** Newest `command` entry for this vehicle and command (entries are newest first). */
function newest(entries: readonly LogEntry[], sysid: number, cmd: string): LogEntry | null {
  return entries.find((e) => e.source === 'command' && e.sysid === sysid && e.text.split(' ')[0] === cmd) ?? null
}

const put = (fb: Feedback, k: string, p: Press): Feedback => new Map(fb).set(k, p)

export function press(fb: Feedback, sysid: number, cmd: string, entries: readonly LogEntry[], now: number): Feedback {
  return put(fb, key(sysid, cmd), { state: 'sending', lastId: newest(entries, sysid, cmd)?.id ?? null, at: now })
}

export function failPress(fb: Feedback, sysid: number, cmd: string, now: number): Feedback {
  return put(fb, key(sysid, cmd), { state: 'fail', lastId: null, at: now })
}

export function clearPress(fb: Feedback, sysid: number, cmd: string): Feedback {
  const out = new Map(fb)
  out.delete(key(sysid, cmd))
  return out
}

/** Settles sending presses whose result arrived; returns `fb` itself when nothing changed. */
export function settle(fb: Feedback, entries: readonly LogEntry[], now: number): Feedback {
  let out: Map<string, Press> | null = null
  fb.forEach((p, k) => {
    if (p.state !== 'sending') return
    const [sysid, cmd] = k.split(':')
    const e = newest(entries, Number(sysid), cmd!)
    if (!e || e.id === p.lastId) return
    out ??= new Map(fb)
    out.set(k, { state: e.severity === 'error' ? 'fail' : 'ok', lastId: e.id, at: now })
  })
  return out ?? fb
}

export function stateOf(fb: Feedback, sysid: number, cmd: string, now: number): BtnState | null {
  const p = fb.get(key(sysid, cmd))
  if (!p) return null
  const limit = p.state === 'sending' ? GIVE_UP_MS : SHOW_MS
  return now - p.at <= limit ? p.state : null
}
