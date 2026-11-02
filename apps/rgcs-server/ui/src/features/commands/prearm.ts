// Why ARM did nothing (operator proposal 7): ArduPilot answers a refused arm with STATUSTEXT
// "PreArm: …" / "Arm: …"; the panel shows the vehicle's recent ones under the ARM button.
import type { LogEntry } from '../../shared/api/types'

const WINDOW_MS = 30_000
const MAX = 3

export function prearmReasons(entries: readonly LogEntry[], sysid: number, now: number): string[] {
  const out: string[] = []
  for (const e of entries) {
    if (out.length >= MAX) break
    if (e.sysid !== sysid || e.source !== 'vehicle' || now - e.ts > WINDOW_MS) continue
    if (!/^(PreArm|Arm):/.test(e.text) || out.includes(e.text)) continue
    out.push(e.text)
  }
  return out
}
