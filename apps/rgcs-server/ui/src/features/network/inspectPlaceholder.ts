// Inspector content for the dim 未構成 placeholders: what M5 would put there.
import type { Dict } from '../../shared/i18n'
import type { NetworkTopology } from '../../shared/api/types'
import type { Inspection } from './inspect'

type Ph = Pick<Inspection, 'icon' | 'title' | 'sub'>

function lte(n: string | undefined, t: NetworkTopology): Ph | null {
  if (n === undefined) return t.vehicles.length > 8 ? { icon: 'radio-tower', title: 'LTE', sub: `LTE × ${t.vehicles.length}` } : null
  const v = t.vehicles.find((x) => String(x.sysid) === n)
  return v === undefined ? null : { icon: 'radio-tower', title: 'LTE', sub: v.name }
}

function describe(name: string, n: string | undefined, t: NetworkTopology, dict: Dict): Ph | null {
  switch (name) {
    case 'hub':
      return { icon: 'server', title: dict.netHub, sub: dict.netZoneCloud }
    case 'lte':
      return lte(n, t)
    case 'gw':
      return { icon: 'router', title: dict.netGateway, sub: dict.netZoneSite }
    case 'uplink':
      return { icon: 'globe', title: dict.netUplink, sub: dict.netZoneInet }
    case 'users':
      return { icon: 'laptop', title: dict.netRemoteUsers, sub: dict.netUsersRemote }
    case 'ntrip':
      return { icon: 'radio-tower', title: dict.netNtrip, sub: dict.netExternal }
    default:
      return null
  }
}

/** `ph:<name>[:<sysid>]` or its edge `e:ph:…`; null when `sel` is not a placeholder drawn for `t`. */
export function placeholderInspection(sel: string, t: NetworkTopology, dict: Dict): Inspection | null {
  const m = /^(?:e:)?ph:([a-z]+)(?::(\d+))?$/.exec(sel)
  const ph = m === null ? null : describe(m[1], m[2], t, dict)
  if (ph === null) return null
  return { ...ph, kv: [{ k: dict.netState, v: dict.netUnconfigured, cls: 'dim' }], tables: [], note: dict.netNoteM5 }
}
