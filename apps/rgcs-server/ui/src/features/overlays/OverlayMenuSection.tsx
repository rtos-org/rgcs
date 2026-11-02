import type { PluginInfo } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconCheck, IconExternalLink } from '../../shared/ui/icons'
import { activeLinks, activeOverlays, pickText, pluginsStore, usePlugins, type ActiveOverlay, type PluginsStore } from './plugins'
import { MAX_OPACITY, MIN_OPACITY, overlayPrefsStore, prefsFor, useOverlayPrefs, type OverlayPrefsStore } from './prefs'

interface Props {
  readonly dict: Dict
  /** Opens the area sheet of an `area` overlay. */
  readonly onManage: (target: ActiveOverlay) => void
  readonly prefs?: OverlayPrefsStore
  readonly plugins?: PluginsStore
}

/** The base-map menu's "Overlays" section: each plugin overlay's switch, opacity, legend and
 * area sheet, then the plugins' links. Nothing when no plugin adds any. */
export function OverlayMenuSection({ dict, onManage, prefs = overlayPrefsStore(), plugins = pluginsStore() }: Props) {
  const list = usePlugins(true, plugins).plugins
  const overlays = activeOverlays(list)
  const linked = activeLinks(list)
  if (overlays.length === 0 && linked.length === 0) return null
  return (
    <>
      {overlays.length > 0 && (
        <div className="ov-menu" role="group" aria-label={dict.ovSection}>
          <div className="ov-menu-head">{dict.ovSection}</div>
          {overlays.map((o) => (
            <OverlayItem key={o.key} o={o} dict={dict} store={prefs} onManage={onManage} />
          ))}
        </div>
      )}
      {linked.map((p) => (
        <PluginLinks key={p.id} p={p} lang={dict.langCode} />
      ))}
    </>
  )
}

function OverlayItem({ o, dict, store, onManage }: { o: ActiveOverlay; dict: Dict; store: OverlayPrefsStore; onManage: Props['onManage'] }) {
  const state = useOverlayPrefs(store)
  const def = o.overlay.default_opacity
  const p = prefsFor(state, o.key, def)
  const name = pickText(o.overlay.name, dict.langCode)
  return (
    <>
      <button type="button" role="menuitemcheckbox" aria-checked={p.on} className={p.on ? 'on' : ''} onClick={() => store.toggle(o.key, def)}>
        <span className="grow">{name}</span>
        {p.on && <IconCheck size={16} />}
      </button>
      {p.on && (
        <label className="ov-opacity">
          <span>{dict.ovOpacity}</span>
          <input type="range" min={MIN_OPACITY} max={MAX_OPACITY} step={5} value={p.opacity} aria-label={`${name} ${dict.ovOpacity}`} onChange={(e) => store.setOpacity(o.key, Number(e.target.value), def)} />
          <span className="num">{p.opacity}%</span>
        </label>
      )}
      {p.on && o.overlay.legend.length > 0 && (
        <ul className="ov-legend" aria-label={name}>
          {o.overlay.legend.map((l) => (
            <li key={`${l.color}${l.label.en}`}>
              <span className="ov-swatch" style={{ background: l.color }} />
              {pickText(l.label, dict.langCode)}
            </li>
          ))}
        </ul>
      )}
      {o.overlay.cache === 'area' && (
        <button type="button" role="menuitem" aria-label={`${name}: ${dict.ovManage}`} onClick={() => onManage(o)}>
          <span className="grow ov-manage">{dict.ovManage}</span>
        </button>
      )}
    </>
  )
}

function PluginLinks({ p, lang }: { p: PluginInfo; lang: string }) {
  const name = pickText(p.name, lang)
  return (
    <div className="ov-menu" role="group" aria-label={name}>
      <div className="ov-menu-head">{name}</div>
      {p.links.map((l) => (
        <a key={l.url} role="menuitem" className="ov-link" href={l.url} target="_blank" rel="noopener noreferrer">
          <span className="grow">{pickText(l.label, lang)}</span>
          <IconExternalLink size={14} />
        </a>
      ))}
    </div>
  )
}
