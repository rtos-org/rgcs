// Tap-to-place and double-tap on the assignment board.
// A pure reducer: the UI feeds it taps and acts on the returned action.

export const DOUBLE_TAP_MS = 320

export interface TapState {
  readonly picked: number | null
  readonly last: { readonly key: string; readonly t: number } | null
}

export const initialTaps: TapState = { picked: null, last: null }

export type TapTarget =
  | { readonly kind: 'plan'; readonly id: number }
  | { readonly kind: 'vehicle'; readonly sysid: number }
  | { readonly kind: 'empty' }

export type TapAction =
  | 'pick'
  | 'unpick'
  | 'none'
  | { readonly assign: readonly [number, number] }
  | { readonly blocked: readonly [number, number] }
  | { readonly locked: number }
  | { readonly focus: TapTarget }

export interface TapContext {
  readonly canAssign?: (planId: number, sysid: number) => boolean
  readonly canPick?: (planId: number) => boolean
}

export interface TapResult {
  readonly state: TapState
  readonly action: TapAction
}

const keyOf = (target: Exclude<TapTarget, { kind: 'empty' }>): string =>
  target.kind === 'plan' ? `p${target.id}` : `v${target.sysid}`

const isDouble = (state: TapState, key: string, now: number): boolean =>
  state.last !== null && state.last.key === key && now - state.last.t < DOUBLE_TAP_MS

function tapPlan(state: TapState, id: number, ctx: TapContext): TapResult {
  if (ctx.canPick && !ctx.canPick(id)) return { state, action: { locked: id } }
  if (state.picked === id) return { state: { ...state, picked: null }, action: 'unpick' }
  return { state: { ...state, picked: id }, action: 'pick' }
}

function tapVehicle(state: TapState, sysid: number, ctx: TapContext): TapResult {
  const planId = state.picked
  if (planId === null) return { state, action: 'none' }
  if (ctx.canAssign && !ctx.canAssign(planId, sysid)) return { state, action: { blocked: [planId, sysid] } }
  return { state, action: { assign: [planId, sysid] } }
}

function doubleTap(state: TapState, target: TapTarget, ctx: TapContext): TapResult {
  // The second tap of a double never undoes the first: a plan stays (or becomes) picked.
  const keepPick = target.kind === 'plan' && (!ctx.canPick || ctx.canPick(target.id))
  const picked = keepPick && target.kind === 'plan' ? target.id : state.picked
  return { state: { picked, last: null }, action: { focus: target } }
}

export function tap(state: TapState, target: TapTarget, now: number, ctx: TapContext = {}): TapResult {
  if (target.kind === 'empty') {
    const action: TapAction = state.picked === null ? 'none' : 'unpick'
    return { state: { picked: null, last: null }, action }
  }
  const key = keyOf(target)
  if (isDouble(state, key, now)) return doubleTap(state, target, ctx)
  const stamped: TapState = { ...state, last: { key, t: now } }
  return target.kind === 'plan' ? tapPlan(stamped, target.id, ctx) : tapVehicle(stamped, target.sysid, ctx)
}

export function escape(state: TapState): TapState {
  return state.picked === null ? state : { ...state, picked: null }
}
