// プラグイン: the plugins the server found at start,
// with why a broken one did not load, and an admin-only switch per plugin.
import { useState } from 'react'
import type { PluginInfo } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { setPluginEnabled } from '../overlays/api'
import { pickText, pluginsStore, usePlugins, type PluginsStore } from '../overlays/plugins'

interface Props {
  readonly dict: Dict
  readonly isAdmin: boolean
  readonly store?: PluginsStore
  readonly setEnabled?: (id: string, enabled: boolean) => Promise<unknown>
}

/** A broken plugin's reason in the operator's words (the raw code when unknown). */
function reason(code: string | null, dict: Dict): string {
  const key = `plugErr_${code ?? ''}` as keyof Dict
  return dict.plugErr.replace('{reason}', key in dict ? dict[key] : (code ?? ''))
}

export function PluginsCard({ dict, isAdmin, store = pluginsStore(), setEnabled = setPluginEnabled }: Props) {
  const state = usePlugins(true, store)
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const toggle = async (p: PluginInfo) => {
    setBusy(p.id)
    setFailed(false)
    try {
      await setEnabled(p.id, !p.enabled)
    } catch {
      setFailed(true)
    }
    await store.reload()
    setBusy(null)
  }
  return (
    <div className="surface plug-card" data-testid="plugins-card">
      <div className="h1">{dict.plugTitle}</div>
      <div className="t3 plug-note">{dict.plugNote}</div>
      {state.error && <div className="hint caution">{dict.plugLoadFailed}</div>}
      {failed && <div className="hint caution">{dict.failed}</div>}
      {state.loaded && state.plugins.length === 0 && !state.error && <div className="t3">{dict.plugNone}</div>}
      {state.plugins.length > 0 && (
        <ul className="plug-list">
          {state.plugins.map((p) => (
            <PluginRow key={p.id} p={p} dict={dict} disabled={!isAdmin || busy !== null} onToggle={() => void toggle(p)} />
          ))}
        </ul>
      )}
      {!isAdmin && state.plugins.length > 0 && <div className="t3 plug-note">{dict.plugAdminOnly}</div>}
    </div>
  )
}

function PluginRow({ p, dict, disabled, onToggle }: { p: PluginInfo; dict: Dict; disabled: boolean; onToggle: () => void }) {
  const name = pickText(p.name, dict.langCode)
  const ok = p.status === 'ok'
  return (
    <li className={`inset plug-row${ok && p.enabled ? '' : ' off'}`}>
      <button type="button" className="switch" role="switch" aria-checked={p.enabled} aria-label={name} disabled={disabled} onClick={onToggle}>
        <span className="knob" />
      </button>
      <div className="plug-main">
        <div className="plug-head">
          <span className="plug-name">{name}</span>
          <span className="t3 mono">{p.version ? `${p.id} ${p.version}` : p.id}</span>
        </div>
        {p.description && <div className="t3">{pickText(p.description, dict.langCode)}</div>}
        {ok ? <div className="t3 num">{dict.plugCounts.replace('{overlays}', String(p.overlays.length)).replace('{links}', String(p.links.length))}</div> : <div className="hint caution">{reason(p.error, dict)}</div>}
        {p.author && <div className="t3">{dict.plugBy.replace('{author}', p.author)}</div>}
      </div>
    </li>
  )
}
