// Sign-in transition ("through the clouds"): a pure state machine with injected time.
// idle → gather → done → clear → app; a failed sign-in goes gather → idle(error).
// The CSS in styles/login.css plays each phase; this file only decides when phases change,
// so React re-renders once per phase, never per frame.

export type Phase = 'idle' | 'gather' | 'done' | 'clear' | 'app'

export interface Intro {
  readonly phase: Phase
  /** When the current phase started (ms, caller's clock). */
  readonly at: number
  /** prefers-reduced-motion at submit: no clouds, a 300 ms crossfade. */
  readonly reduced: boolean
  readonly authed: boolean
  readonly painted: boolean
  readonly error: boolean
}

export type IntroEvent =
  | { readonly type: 'submit'; readonly now: number; readonly reduced: boolean }
  | { readonly type: 'auth'; readonly ok: boolean; readonly now: number }
  | { readonly type: 'painted'; readonly now: number }
  | { readonly type: 'tick'; readonly now: number }

export const INTRO_MS = {
  /** Clouds gather for at least this long, even when the server answers sooner. */
  gatherMin: 2400,
  /** Login UI fades out; the app mounts under the clouds. */
  done: 700,
  /** Longest wait for the app's first paint (map tiles) before the clouds clear anyway. */
  paintMax: 1500,
  /** Clouds clear: haze, then dense, then thin. */
  clear: 4100,
  /** Reduced motion: login UI → app crossfade. */
  reduced: 300,
} as const

export const IDLE: Intro = { phase: 'idle', at: 0, reduced: false, authed: false, painted: false, error: false }

/** Phases in which the login scene (background, clouds, login UI) stays on screen. */
export function isScene(phase: Phase): boolean {
  return phase === 'gather' || phase === 'done' || phase === 'clear'
}

function enter(s: Intro, phase: Phase, now: number): Intro {
  return { ...s, phase, at: now }
}

/** Moves on when the current phase's conditions hold at `now`. */
function advance(s: Intro, now: number): Intro {
  const age = now - s.at
  switch (s.phase) {
    case 'gather':
      return s.authed && (s.reduced || age >= INTRO_MS.gatherMin) ? advance(enter(s, 'done', now), now) : s
    case 'done':
      if (s.reduced) return age >= INTRO_MS.reduced ? enter(s, 'app', now) : s
      return age >= INTRO_MS.done && (s.painted || age >= INTRO_MS.paintMax) ? enter(s, 'clear', now) : s
    case 'clear':
      return age >= INTRO_MS.clear ? enter(s, 'app', now) : s
    default:
      return s
  }
}

export function step(s: Intro, e: IntroEvent): Intro {
  switch (e.type) {
    case 'submit':
      if (isScene(s.phase)) return s
      return { phase: 'gather', at: e.now, reduced: e.reduced, authed: false, painted: false, error: false }
    case 'auth':
      if (s.phase !== 'gather') return s
      return e.ok ? advance({ ...s, authed: true }, e.now) : { ...enter(s, 'idle', e.now), error: true }
    case 'painted':
      return s.phase === 'done' ? advance({ ...s, painted: true }, e.now) : s
    case 'tick':
      return advance(s, e.now)
  }
}

/** The next time a `tick` can change the state, or null when only an event can. */
export function nextWake(s: Intro): number | null {
  switch (s.phase) {
    case 'gather':
      return s.authed && !s.reduced ? s.at + INTRO_MS.gatherMin : null
    case 'done':
      if (s.reduced) return s.at + INTRO_MS.reduced
      return s.at + (s.painted ? INTRO_MS.done : INTRO_MS.paintMax)
    case 'clear':
      return s.at + INTRO_MS.clear
    default:
      return null
  }
}
