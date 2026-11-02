import type { MissionTransfer } from '../../shared/api/types'

/** Writing takes the first 70 % of the bar, the read-back check the rest. */
const WRITE_SHARE = 70

export function transferPercent(t: MissionTransfer): number {
  const f = t.total === 0 ? 1 : t.done / t.total
  if (t.phase === 'write') return Math.round(f * WRITE_SHARE)
  if (t.phase === 'verify') return Math.round(WRITE_SHARE + f * (100 - WRITE_SHARE))
  return 100
}
