import type { InspectorDir, InspectorRow } from '../../shared/api/types'

export interface ComponentNode {
  readonly compid: number
  readonly rows: readonly InspectorRow[]
}
export interface SystemNode {
  readonly sysid: number
  readonly components: readonly ComponentNode[]
}
export interface DirNode {
  readonly dir: InspectorDir
  readonly systems: readonly SystemNode[]
}

/** MAV_COMPONENT names for the ids seen on a typical vehicle. */
const COMPONENTS: Record<number, string> = { 0: 'All', 1: 'Autopilot', 100: 'Camera', 154: 'Gimbal', 190: 'GCS', 191: 'Onboard computer', 195: 'Gimbal (MAVLink)', 240: 'UDP bridge', 242: 'Telemetry radio' }

export const componentName = (compid: number): string => COMPONENTS[compid] ?? `COMP ${compid}`
export const rowKey = (r: InspectorRow): string => `${r.dir}/${r.sysid}/${r.compid}/${r.msg_id}`

const uniq = (xs: readonly number[]) => [...new Set(xs)].sort((a, b) => a - b)

/** 受信 / 送信 → system → component → messages (by name); `filter` matches message names. */
export function groupRows(rows: readonly InspectorRow[], filter: string): DirNode[] {
  const q = filter.trim().toUpperCase()
  const shown = rows.filter((r) => !q || r.name.includes(q))
  return (['rx', 'tx'] as const).flatMap((dir) => {
    const inDir = shown.filter((r) => r.dir === dir)
    if (inDir.length === 0) return []
    const systems = uniq(inDir.map((r) => r.sysid)).map((sysid) => {
      const inSys = inDir.filter((r) => r.sysid === sysid)
      const components = uniq(inSys.map((r) => r.compid)).map((compid) => ({
        compid,
        rows: inSys.filter((r) => r.compid === compid).sort((a, b) => a.name.localeCompare(b.name)),
      }))
      return { sysid, components }
    })
    return [{ dir, systems }]
  })
}
