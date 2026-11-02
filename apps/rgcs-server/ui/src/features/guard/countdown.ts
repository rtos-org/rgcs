// The L2 countdown shown on the banner. The deadline comes from the server (rebased onto the local
// clock in alerts.ts); the server's 1 Hz re-send keeps it honest.

/** Whole seconds left, rounded up and never below zero; null without a deadline. */
export function secondsLeft(deadlineMs: number | null, now: number): number | null {
  if (deadlineMs === null) return null
  return Math.max(0, Math.ceil((deadlineMs - now) / 1000))
}
