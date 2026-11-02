// What a selection lights up (prototype `netRel`, reduced to the one real path
// vehicle → link → server → clients, plus the unconfigured M5 placeholders as one group).
import type { NetGraph } from './graph'

/** Every placeholder id drawn for this graph. */
export function placeholderIds(g: NetGraph): readonly string[] {
  const lte = g.vehicles.length > 8 ? ['ph:lte', 'e:ph:lte'] : g.vehicles.flatMap((v) => [`ph:lte:${v.sysid}`, `e:ph:lte:${v.sysid}`])
  return ['ph:hub', ...lte, 'ph:gw', 'ph:uplink', 'e:ph:uplink', 'ph:users', 'e:ph:users', 'ph:ntrip', 'e:ph:ntrip']
}

const vehicleIds = (sysid: number) => [`v:${sysid}`, `r:${sysid}`, `e:v:${sysid}`]
const clientSide = (g: NetGraph) => ['server', 'ws', 'media', ...g.clients.flatMap((c) => [`c:${c.id}`, `e:c:${c.id}`])]

function vehicleRoute(sysid: number, g: NetGraph): readonly string[] | null {
  const v = g.vehicles.find((x) => x.sysid === sysid)
  return v === undefined ? null : [...vehicleIds(sysid), `link:${v.link_id}`, ...clientSide(g)]
}

function clientRoute(id: number, g: NetGraph): readonly string[] | null {
  if (!g.clients.some((c) => c.id === id)) return null
  const links = g.link === null ? [] : [`link:${g.link.id}`]
  return [`c:${id}`, `e:c:${id}`, 'ws', 'server', ...links, ...g.vehicles.flatMap((v) => vehicleIds(v.sysid))]
}

function placeholderRoute(sel: string, g: NetGraph): readonly string[] {
  const own = /^(?:e:)?ph:lte:(\d+)$/.exec(sel)
  return [sel, ...placeholderIds(g), ...(own === null ? [] : [`v:${own[1]}`, `r:${own[1]}`])]
}

function routeOf(sel: string, g: NetGraph): readonly string[] | null {
  const [kind, a] = sel.split(':')
  if (kind === 'ph' || sel.startsWith('e:ph:')) return placeholderRoute(sel, g)
  if (kind === 'v' || kind === 'r') return vehicleRoute(Number(a), g)
  if (sel.startsWith('e:v:')) return vehicleRoute(Number(sel.slice(4)), g)
  if (kind === 'c') return clientRoute(Number(a), g)
  if (sel.startsWith('e:c:')) return clientRoute(Number(sel.slice(4)), g)
  if (kind === 'link') return [sel, 'server', ...g.vehicles.filter((v) => `link:${v.link_id}` === sel).flatMap((v) => vehicleIds(v.sysid))]
  if (sel === 'ws' || sel === 'media') return clientSide(g)
  return null
}

/** The ids to keep bright for `sel`; null = nothing dimmed (the server, or an unknown id). */
export function related(sel: string, g: NetGraph): ReadonlySet<string> | null {
  if (sel === 'server') return null
  const route = routeOf(sel, g)
  return route === null ? null : new Set([sel, ...route])
}
