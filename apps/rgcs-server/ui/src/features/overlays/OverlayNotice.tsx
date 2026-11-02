import type { OverlayArea } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { areasHub, areasOf, useAreas } from './areasHub'
import { noticeDates } from './layer'
import { pickText, type ActiveOverlay } from './plugins'
import { useVisibleOverlays, type OverlayStores } from './useOverlays'

/** One overlay's line: its notice plus the fetch / data dates for an `area` overlay; null when
 * a `direct` overlay has no notice. */
export function noticeText(o: ActiveOverlay, areas: readonly OverlayArea[], dict: Dict): string | null {
  const lang = dict.langCode
  const notice = pickText(o.overlay.notice, lang)
  if (o.overlay.cache === 'direct') return notice || null
  const name = pickText(o.overlay.name, lang)
  const dates = noticeDates(areas)
  if (!dates) return dict.ovNone.replace('{name}', name)
  const when = dict.ovNoticeDates.replace('{fetched}', dates.fetched).replace('{data}', dates.data ?? dict.ovUnknown)
  return `${notice || name}${when}`
}

/** While overlays are on: each one's source and limits (e.g. a public coverage map, nothing about the air). */
export function OverlayNotice({ dict, stores }: { readonly dict: Dict; readonly stores?: Partial<OverlayStores> }) {
  const visible = useVisibleOverlays(true, stores)
  const all = useAreas(
    visible.filter((o) => o.overlay.cache === 'area').map((o) => o.ref),
    stores?.areas ?? areasHub(),
  )
  const lines = visible.flatMap((o) => {
    const text = noticeText(o, areasOf(all, o.key).areas, dict)
    return text ? [{ key: o.key, text }] : []
  })
  if (lines.length === 0) return null
  return (
    <div className="ov-notices">
      {lines.map((l) => (
        <div key={l.key} className="g-ctl ov-notice" role="note">
          {l.text}
        </div>
      ))}
    </div>
  )
}
