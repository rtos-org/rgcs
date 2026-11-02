export type PlayerPhase = 'idle' | 'connecting' | 'playing' | 'reconnecting' | 'stopped'

export interface PlayerState {
  readonly phase: PlayerPhase
  /** Consecutive failures since the last successful picture. */
  readonly attempt: number
  /** True once a frame was shown; failures never clear the last frame. */
  readonly holdFrame: boolean
  readonly lastError: string | null
}

export const INITIAL_PLAYER: PlayerState = { phase: 'idle', attempt: 0, holdFrame: false, lastError: null }

const BACKOFF_BASE_MS = 1000
const BACKOFF_MAX_MS = 5000

export const start = (s: PlayerState): PlayerState => ({ ...s, phase: 'connecting' })
export const connected = (s: PlayerState): PlayerState => ({ ...s, phase: 'playing', attempt: 0, holdFrame: true, lastError: null })
export const failed = (s: PlayerState, error: string): PlayerState => ({ ...s, phase: 'reconnecting', attempt: s.attempt + 1, lastError: error })
export const stopped = (s: PlayerState): PlayerState => ({ ...s, phase: 'stopped' })

/** Delay before retry number `attempt + 1`: 1, 2, 4, then 5 s. */
export function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt)
}
