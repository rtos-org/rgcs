// Drives the pure intro machine (./intro) with one timer per phase change: the state, and with it
// a React render, changes at most four times per sign-in. The CSS does every frame in between.
import { useSyncExternalStore } from 'react'
import { markAppPainted, onAppPainted } from '../../shared/ui/appPaint'
import { IDLE, nextWake, step, type Intro, type IntroEvent } from './intro'

export interface IntroDeps {
  readonly now: () => number
  readonly reducedMotion: () => boolean
  /** Runs `fn` after `ms`; returns a cancel function. Tests inject a manual clock. */
  readonly schedule?: (fn: () => void, ms: number) => () => void
}

function timeout(fn: () => void, ms: number): () => void {
  const id = setTimeout(fn, ms)
  return () => clearTimeout(id)
}

export { markAppPainted }

export function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

const DEFAULT_DEPS: IntroDeps = { now: () => performance.now(), reducedMotion: prefersReducedMotion }

export class IntroStore {
  private state: Intro = IDLE
  private cancel: (() => void) | null = null
  private readonly listeners = new Set<() => void>()
  private readonly deps: IntroDeps

  constructor(deps: IntroDeps = DEFAULT_DEPS) {
    this.deps = deps
    onAppPainted(() => this.dispatch({ type: 'painted', now: this.deps.now() }))
  }

  getState = (): Intro => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  submit(): void {
    this.dispatch({ type: 'submit', now: this.deps.now(), reduced: this.deps.reducedMotion() })
  }

  authResult(ok: boolean): void {
    this.dispatch({ type: 'auth', ok, now: this.deps.now() })
  }

  private dispatch(e: IntroEvent): void {
    const next = step(this.state, e)
    if (next === this.state) return
    this.state = next
    this.schedule()
    this.listeners.forEach((l) => l())
  }

  private schedule(): void {
    this.cancel?.()
    this.cancel = null
    const wake = nextWake(this.state)
    if (wake === null) return
    const schedule = this.deps.schedule ?? timeout
    this.cancel = schedule(() => {
      this.cancel = null
      this.dispatch({ type: 'tick', now: Math.max(this.deps.now(), wake) })
    }, Math.max(0, wake - this.deps.now()))
  }
}

export const introStore = new IntroStore()

export function useIntro(store: IntroStore = introStore): Intro {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
