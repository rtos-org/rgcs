import { useEffect, useRef } from 'react'
import type { Dict } from '../../shared/i18n'
import type { LatLon } from './store'

export interface MapPoint extends LatLon {
  /** Viewport position of the click (the menu is `position: fixed`). */
  readonly x: number
  readonly y: number
}

interface Props {
  readonly at: MapPoint
  /** The vehicle the command would go to, `null` when none is selected. */
  readonly vehicleName: string | null
  readonly dict: Dict
  readonly onGuided: (p: LatLon) => void
  readonly onClose: () => void
}

/** Right-click on the operations map (operator proposal 8): send the selected vehicle here. */
export function MapContextMenu({ at, vehicleName, dict, onGuided, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current()
    const onDown = (e: PointerEvent) => !(e.target instanceof Node && box.current?.contains(e.target)) && close.current()
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [])
  return (
    <div ref={box} className="ctx-menu g-strong" role="menu" style={{ left: at.x, top: at.y }}>
      {vehicleName && <div className="ctx-head t3">{vehicleName}</div>}
      <button
        type="button"
        role="menuitem"
        disabled={vehicleName === null}
        onClick={() => {
          onGuided({ lat: at.lat, lon: at.lon })
          onClose()
        }}
      >
        {dict.guidedHere}
      </button>
    </div>
  )
}
