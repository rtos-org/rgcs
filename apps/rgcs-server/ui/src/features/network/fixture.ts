import type { ClientSession, ComponentKind, MavLinkInfo, NetComponent, NetVehicle, NetworkTopology } from '../../shared/api/types'

/** A minimal standalone topology for tests (one link, no vehicles, no clients). */
export function topology(at_unix_ms: number, overrides: Partial<NetworkTopology> = {}): NetworkTopology {
  return {
    server: { hostname: 'gcs', version: '0.1.0', build: 'dev', listen: '0.0.0.0:8000', role: 'standalone', uptime_s: 10, started_unix_ms: 0 },
    links: [],
    vehicles: [],
    clients: [],
    media: { whep_upstream: '', reachable: null },
    unconfigured: ['hub', 'lte', 'mesh', 'gateway', 'ntrip', 'node'],
    at_unix_ms,
    ...overrides,
  }
}

/** A healthy copter on link0 with an autopilot component (tests override the rest). */
export function netVehicle(sysid: number, overrides: Partial<NetVehicle> = {}): NetVehicle {
  return {
    sysid,
    name: `UAV-${String(sysid).padStart(2, '0')}`,
    kind: 'copter',
    link: 'ok',
    link_id: 'link0',
    heartbeat_age_ms: 400,
    components: [netComponent(1, 'autopilot')],
    camera: null,
    video: null,
    ...overrides,
  }
}

export function netComponent(compid: number, kind: ComponentKind, overrides: Partial<NetComponent> = {}): NetComponent {
  return { compid, kind, mav_type: null, rx_msgs_per_s: 10, loss_pct: 0, last_rx_age_ms: 100, ...overrides }
}

/** The MAVLink link `link0` (tcp:127.0.0.1:5760), connected and loss-free. */
export function mavLink(overrides: Partial<MavLinkInfo> = {}): MavLinkInfo {
  return {
    id: 'link0',
    url: 'tcp:127.0.0.1:5760',
    kind: 'tcp',
    connected: true,
    connected_since_unix_ms: 0,
    reconnects: 0,
    last_error: null,
    rx_msgs_per_s: 50,
    rx_bytes_per_s: 2000,
    loss_pct: 0,
    last_rx_age_ms: 100,
    stale: false,
    systems: [],
    ...overrides,
  }
}

export function clientSession(id: number, overrides: Partial<ClientSession> = {}): ClientSession {
  return { id, username: 'admin', role: 'admin', addr: `127.0.0.1:5100${id}`, browser: 'Chrome', connected_since_unix_ms: 0, ...overrides }
}
