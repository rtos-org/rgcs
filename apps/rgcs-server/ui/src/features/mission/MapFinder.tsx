import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Dict } from '../../shared/i18n'
import { IconFollow, IconSearch } from '../../shared/ui/icons'
import type { LatLon } from './geo'
import { parseLatLon, searchPlaces, type PlaceHit } from './placeSearch'

interface Located extends LatLon {
  readonly sysid: number
  readonly name: string
}

interface Props {
  /** Vehicles with a position, for 機体の位置へ. */
  readonly vehicles: readonly Located[]
  readonly dict: Dict
  readonly onGo: (to: LatLon) => void
}

type Panel = 'search' | 'vehicles' | null
type Found = { readonly kind: 'idle' } | { readonly kind: 'busy' } | { readonly kind: 'hits'; readonly hits: readonly PlaceHit[] } | { readonly kind: 'error'; readonly text: string }

/** Map controls of the planner: place / coordinate search and a jump to a vehicle. */
export function MapFinder({ vehicles, dict, onGo }: Props) {
  const [panel, setPanel] = useState<Panel>(null)
  const [text, setText] = useState('')
  const [found, setFound] = useState<Found>({ kind: 'idle' })
  // only the latest lookup may answer; closing the view drops it
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  const go = (to: LatLon) => {
    setPanel(null)
    onGo({ lat: to.lat, lon: to.lon })
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const at = parseLatLon(text)
    if (at) return go(at)
    if (!text.trim()) return
    pending.current?.abort()
    const ctl = new AbortController()
    pending.current = ctl
    setFound({ kind: 'busy' })
    try {
      const hits = await searchPlaces(text.trim(), ctl.signal)
      if (!ctl.signal.aborted) setFound(hits.length ? { kind: 'hits', hits } : { kind: 'error', text: dict.plSearchNone })
    } catch {
      if (!ctl.signal.aborted) setFound({ kind: 'error', text: dict.plSearchFail })
    }
  }
  const locate = () => {
    if (vehicles.length === 1) return go(vehicles[0]!)
    setPanel((p) => (p === 'vehicles' ? null : 'vehicles'))
  }
  return (
    <div className="float map-l top2 finder">
      <div className="finder-btns">
        <button type="button" className={`g-ctl ctl finder-btn${panel === 'search' ? ' on' : ''}`} title={dict.plSearch} aria-label={dict.plSearch} onClick={() => setPanel((p) => (p === 'search' ? null : 'search'))}>
          <IconSearch size={18} />
        </button>
        <button type="button" className={`g-ctl ctl finder-btn${panel === 'vehicles' ? ' on' : ''}`} title={dict.plToVehicle} aria-label={dict.plToVehicle} disabled={vehicles.length === 0} onClick={locate}>
          <IconFollow size={18} />
        </button>
      </div>
      {panel === 'search' && (
        <div className="g-strong finder-panel">
          <form onSubmit={(e) => void submit(e)}>
            <input type="search" className="in" autoFocus placeholder={dict.plSearchHint} aria-label={dict.plSearch} value={text} onChange={(e) => setText(e.target.value)} />
          </form>
          {found.kind === 'busy' && <div className="t3 finder-note">…</div>}
          {found.kind === 'error' && <div className="t3 finder-note">{found.text}</div>}
          {found.kind === 'hits' && (
            <ul className="finder-list">
              {found.hits.map((h, i) => (
                <li key={i}>
                  <button type="button" onClick={() => go(h)} aria-label={h.detail}>
                    <span>{h.name}</span>
                    <span className="t3 ell">{h.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {panel === 'vehicles' && (
        <ul className="g-strong finder-panel finder-list">
          {vehicles.map((v) => (
            <li key={v.sysid}>
              <button type="button" onClick={() => go(v)}>
                <span>{v.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
