import { useSyncExternalStore } from 'react'
import { ApiError, apiFetch, type ApiInit } from '../../shared/api/client'
import type { Me } from '../../shared/api/types'

export type AuthStatus = 'unknown' | 'anon' | 'authed'
export type AuthError = 'invalid' | 'locked' | 'network'

export interface AuthState {
  readonly status: AuthStatus
  readonly me: Me | null
  readonly error: AuthError | null
}

export type ApiFn = <T>(path: string, init?: ApiInit) => Promise<T>

const INITIAL: AuthState = { status: 'unknown', me: null, error: null }
const ANON: AuthState = { status: 'anon', me: null, error: null }

/** Maps a failed login to the message the screen shows. */
export function loginError(e: unknown): AuthError {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'invalid'
    if (e.status === 429) return 'locked'
  }
  return 'network'
}

export class AuthStore {
  private state: AuthState = INITIAL
  private readonly listeners = new Set<() => void>()
  private readonly api: ApiFn

  constructor(api: ApiFn = apiFetch) {
    this.api = api
  }

  getState = (): AuthState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Resolves the session cookie on startup. */
  async load(): Promise<void> {
    try {
      const me = await this.api<Me>('/api/auth/me')
      this.set({ status: 'authed', me, error: null })
    } catch (e) {
      this.set(e instanceof ApiError && e.status === 401 ? ANON : { ...ANON, error: 'network' })
    }
  }

  /**
   * Re-validates the cookie after a WebSocket drop. Only a definite 401 signs the operator
   * out; an unreachable server keeps the session so the socket's backoff can carry the outage.
   */
  async recheck(): Promise<void> {
    try {
      const me = await this.api<Me>('/api/auth/me')
      if (this.state.status !== 'authed') this.set({ status: 'authed', me, error: null })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.set(ANON)
    }
  }

  async login(username: string, password: string): Promise<void> {
    try {
      const me = await this.api<Me>('/api/auth/login', { method: 'POST', body: { username, password } })
      this.set({ status: 'authed', me, error: null })
    } catch (e) {
      this.set({ status: 'anon', me: null, error: loginError(e) })
    }
  }

  async logout(): Promise<void> {
    try {
      await this.api('/api/auth/logout', { method: 'POST' })
    } catch {
      // The cookie is gone or the server is unreachable; either way we are signed out locally.
    }
    this.set(ANON)
  }

  /** Called when any API call returns 401. */
  setAnon(): void {
    if (this.state.status === 'anon' && this.state.error === null) return
    this.set(ANON)
  }

  clearError(): void {
    if (this.state.error === null) return
    this.set({ ...this.state, error: null })
  }

  private set(next: AuthState): void {
    if (next === this.state) return
    this.state = next
    this.listeners.forEach((l) => l())
  }
}

export const authStore = new AuthStore()

export function useAuth(store: AuthStore = authStore): AuthState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
