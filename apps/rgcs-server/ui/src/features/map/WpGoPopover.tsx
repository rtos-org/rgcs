import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { VehicleCommand, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { popoverPlacement, wpGoCommand, type WaypointPick } from './wpGo'

interface Props {
  readonly at: WaypointPick
  /** The badge's vehicle (live state), undefined once it has gone. */
  readonly vehicle: VehicleState | undefined
  readonly dict: Dict
  readonly onSend: (sysid: number, command: VehicleCommand) => void
  readonly onClose: () => void
}

/** Click on a mission badge (ops map): continue the mission from that waypoint, mode unchanged. */
/** Where the box goes once measured (it must not hide 送信 past a viewport edge). */
function usePlacement(at: WaypointPick, box: RefObject<HTMLDivElement | null>) {
  const viewport = () => ({ w: window.innerWidth, h: window.innerHeight })
  const [pos, setPos] = useState(() => popoverPlacement(at, { w: 0, h: 0 }, viewport()))
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect()
    if (r) setPos(popoverPlacement(at, { w: r.width, h: r.height }, viewport()))
  }, [at, box])
  return pos
}

export function WpGoPopover({ at, vehicle, dict, onSend, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const pos = usePlacement(at, box)
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
  const title = dict.wpGoTitle.replace('{n}', String(at.n))
  const lost = vehicle === undefined || vehicle.link === 'lost'
  const send = () => {
    onSend(at.sysid, wpGoCommand(at.n))
    onClose()
  }
  return (
    <div ref={box} className="wp-go g-strong" role="dialog" aria-label={title} style={{ left: pos.left, top: pos.top }}>
      <div className="wp-go-title">{title}</div>
      <div className="t2">{vehicle?.name ?? `#${at.sysid}`}</div>
      {vehicle && vehicle.mode !== 'AUTO' && <div className="wp-go-hint t3">{dict.wpGoAutoHint}</div>}
      {lost && <div className="wp-go-hint t3">{dict.wpGoLinkLost}</div>}
      <div className="wp-go-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {dict.cancel}
        </button>
        <button type="button" className="btn btn-primary" disabled={lost} onClick={send}>
          {dict.wpGoSend}
        </button>
      </div>
    </div>
  )
}
