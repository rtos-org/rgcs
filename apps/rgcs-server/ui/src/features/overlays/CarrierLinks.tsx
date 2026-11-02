// Links to each carrier's official coverage map. Their terms forbid copying the maps, so RGCS only
// links to them; none documents a URL for a position, so the map centre can be copied and pasted
// into their search box instead.
import { useState } from 'react'
import type { Dict } from '../../shared/i18n'
import { IconCheck, IconCopy, IconExternalLink } from '../../shared/ui/icons'
import { viewRectOf, type MapKey } from './mapRegistry'

const CARRIERS: readonly { readonly name: keyof Dict; readonly href: string }[] = [
  { name: 'lteCarrierDocomo', href: 'https://www.docomo.ne.jp/area/map/' },
  { name: 'lteCarrierAu', href: 'https://www.au.com/mobile/area/map/' },
  { name: 'lteCarrierSoftbank', href: 'https://www.softbank.jp/mobile/network/area-map/' },
  { name: 'lteCarrierRakuten', href: 'https://network.mobile.rakuten.co.jp/area/' },
]

/** "lat, lon" of the view's centre, or null with no map. */
function centreText(key: MapKey): string | null {
  const r = viewRectOf(key)
  return r ? `${((r.south + r.north) / 2).toFixed(6)}, ${((r.west + r.east) / 2).toFixed(6)}` : null
}

export function CarrierLinks({ dict, mapKey }: { readonly dict: Dict; readonly mapKey: MapKey }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    const text = centreText(mapKey)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // clipboard blocked (http, permissions): nothing to do
    }
  }
  return (
    <div className="ov-menu" role="group" aria-label={dict.lteCarrierMaps}>
      <div className="ov-menu-head">{dict.lteCarrierMaps}</div>
      {CARRIERS.map((c) => (
        <a key={c.name} role="menuitem" className="ov-link" href={c.href} target="_blank" rel="noopener noreferrer">
          <span className="grow">{dict[c.name]}</span>
          <IconExternalLink size={14} />
        </a>
      ))}
      <button type="button" role="menuitem" onClick={() => void copy()}>
        <span className="grow">{copied ? dict.lteCopied : dict.lteCopyCenter}</span>
        {copied ? <IconCheck size={16} /> : <IconCopy size={14} />}
      </button>
    </div>
  )
}
