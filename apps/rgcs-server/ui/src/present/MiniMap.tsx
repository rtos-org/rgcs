import type { VehicleState } from '../shared/api/types'
import { MapView } from '../features/map/MapView'
import { rasterStyle } from '../features/map/style'
import type { PresentVehicle } from './api'

interface Props {
  readonly vehicle: PresentVehicle | null
  readonly tileUrl: string
  readonly attribution: string
}

/** The audience view's small follow-only map: no controls, no interaction. */
export function MiniMap({ vehicle, tileUrl, attribution }: Props) {
  const vehicles = new Map<number, VehicleState>()
  if (vehicle) {
    vehicles.set(vehicle.sysid, {
      sysid: vehicle.sysid,
      name: vehicle.name,
      kind: 'copter',
      mode: vehicle.mode,
      armed: vehicle.armed,
      lat: vehicle.lat,
      lon: vehicle.lon,
      alt_rel: vehicle.alt_rel,
      alt_msl: 0,
      hdg: vehicle.hdg,
      ground_speed: 0,
      climb: 0,
      battery: { pct: null, volt: 0, current: null },
      link: vehicle.link,
      last_rx_ms: 0,
      gps: { fix: vehicle.lat === 0 && vehicle.lon === 0 ? 0 : 3, sats: 0, hdop: null },
      warn: false,
      unread: 0,
    })
  }
  return (
    <div className="present-map">
      <MapView
        vehicles={vehicles}
        tracks={new Map()}
        follow={vehicle?.sysid ?? null}
        selected={vehicle?.sysid ?? null}
        padding={{ top: 0, left: 0, right: 0, bottom: 0 }}
        style={rasterStyle(tileUrl, attribution)}
        target={null}
        onDragStart={() => {}}
        onClick={() => {}}
        interactive={false}
      />
    </div>
  )
}
