export const PENDING_TTL_MS = 3000

/** Commands sent but not yet reflected by a `camera_state` (disables the record toggle). */
export interface PendingState {
  readonly bySysid: ReadonlyMap<number, { readonly name: string; readonly at: number }>
}

export const EMPTY_PENDING: PendingState = { bySysid: new Map() }

export function markPending(p: PendingState, sysid: number, name: string, at: number): PendingState {
  const bySysid = new Map(p.bySysid)
  bySysid.set(sysid, { name, at })
  return { bySysid }
}

export function clearPending(p: PendingState, sysid: number): PendingState {
  if (!p.bySysid.has(sysid)) return p
  const bySysid = new Map(p.bySysid)
  bySysid.delete(sysid)
  return { bySysid }
}

export function isPending(p: PendingState, sysid: number, now: number): boolean {
  const e = p.bySysid.get(sysid)
  return e !== undefined && now - e.at < PENDING_TTL_MS
}
