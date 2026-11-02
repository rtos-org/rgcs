import type { Dict } from '../../shared/i18n'
import type { MapMode } from './mapMode'

interface Props {
  readonly mode: MapMode
  /** False when no terrain tiles are configured. */
  readonly available: boolean
  readonly dict: Dict
  readonly onChange: (mode: MapMode) => void
}

/** Prototype `seg onmap float map-r top1` 2D / 3D switch. */
export function MapModeToggle({ mode, available, dict, onChange }: Props) {
  const is3d = mode === '3d' && available
  return (
    <div className="seg onmap float map-r top1" style={{ width: 148, height: 40 }} role="group" aria-label="2D / 3D">
      <span className="lens" style={{ transform: is3d ? 'translateX(100%)' : 'translateX(0)' }} />
      <button type="button" className={is3d ? '' : 'on'} style={{ fontSize: 14 }} onClick={() => onChange('2d')}>
        2D
      </button>
      <button
        type="button"
        className={is3d ? 'on' : available ? '' : 'off'}
        aria-disabled={!available}
        title={available ? undefined : dict.map3dUnavailable}
        style={{ fontSize: 14 }}
        onClick={() => available && onChange('3d')}
      >
        3D
      </button>
    </div>
  )
}
