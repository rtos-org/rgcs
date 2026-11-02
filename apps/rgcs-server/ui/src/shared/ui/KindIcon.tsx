import type { VehicleKind } from '../api/types'
import { IconCopter, IconPlane, IconRover } from './icons'

/** The vehicle's type icon: plane / QuadPlane, rover, else the multicopter. */
export function KindIcon({ kind, size }: { readonly kind: VehicleKind; readonly size?: number }) {
  if (kind === 'plane') return <IconPlane size={size} />
  if (kind === 'rover') return <IconRover size={size} />
  return <IconCopter size={size} />
}
