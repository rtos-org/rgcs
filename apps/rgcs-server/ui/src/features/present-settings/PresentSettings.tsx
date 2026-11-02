import { useEffect, useState } from 'react'
import { IconImageUp } from '../../shared/ui/icons'
import type { Dict } from '../../shared/i18n'
import { createToken, deleteLogo, listTokens, revokeToken, uploadLogo, type PresentationToken } from './api'

interface Props {
  readonly isAdmin: boolean
  readonly logo: boolean
  readonly onClose: () => void
  readonly dict: Dict
}

/** Presentation links and the logo. Operators only see the list. */
export function PresentSettings({ isAdmin, logo, onClose, dict }: Props) {
  const [tokens, setTokens] = useState<readonly PresentationToken[]>([])
  const [label, setLabel] = useState('')
  const [link, setLink] = useState<string | null>(null)
  const [hasLogo, setHasLogo] = useState(logo)
  const [error, setError] = useState<string | null>(null)

  const refresh = () =>
    listTokens()
      .then(setTokens)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  useEffect(() => {
    void refresh()
  }, [])

  const create = async () => {
    try {
      const r = await createToken(label.trim())
      setLink(`${window.location.origin}${r.url}`)
      setLabel('')
      await refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const revoke = async (prefix: string) => {
    await revokeToken(prefix).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    await refresh()
  }
  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      await uploadLogo(file)
      setHasLogo(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="g-strong confirm present-settings" role="dialog" aria-label={dict.presentTitle}>
        <div className="h2">{dict.presentTitle}</div>
        {isAdmin && (
          <div className="form wide">
            <label htmlFor="present-label">{dict.presentLabel}</label>
            <input id="present-label" className="in" value={label} onChange={(e) => setLabel(e.target.value)} />
            <span />
            <button type="button" className="btn btn-primary" disabled={label.trim() === ''} onClick={() => void create()}>
              {dict.presentCreate}
            </button>
          </div>
        )}
        {link && (
          <div className="warnbox present-link-box">
            <span className="mono" data-testid="present-link">
              {link}
            </span>
            <button type="button" className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(link)}>
              {dict.copy}
            </button>
          </div>
        )}
        <table className="tbl compact">
          {tokens.length > 0 && (
            <thead>
              <tr>
                <th>{dict.psLabel}</th>
                <th>{dict.psToken}</th>
                <th>{dict.psState}</th>
                <th />
              </tr>
            </thead>
          )}
          <tbody>
            {tokens.map((tk) => (
              <tr key={tk.token_prefix}>
                <td>{tk.label}</td>
                <td className="mono">{tk.token_prefix}…</td>
                <td className="t3">{tk.revoked_at ? dict.revoked : dict.active}</td>
                <td>
                  {isAdmin && !tk.revoked_at && (
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => void revoke(tk.token_prefix)}>
                      {dict.revoke}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isAdmin && (
          <div className="form wide">
            <span>{dict.presentLogo}</span>
            {/* an app button over a hidden input: no browser-language "Choose File" */}
            <label className="btn btn-sm present-logo-pick">
              <IconImageUp size={14} />
              {dict.psPickLogo}
              <input type="file" className="sr-only" aria-label={dict.presentLogo} accept="image/png,image/svg+xml" onChange={(e) => void onFile(e.target.files?.[0])} />
            </label>
            <span className="t3">{hasLogo ? dict.logoSet : dict.logoUnset}</span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={!hasLogo}
              onClick={() => void deleteLogo().then(() => setHasLogo(false))}
            >
              {dict.logoRemove}
            </button>
          </div>
        )}
        {error && <div className="danger">{error}</div>}
        <div className="confirm-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {dict.close}
          </button>
        </div>
      </div>
    </div>
  )
}
