import { useEffect, useRef, useState, type FormEvent } from 'react'
import { apiFetch } from '../../shared/api/client'
import type { Health } from '../../shared/api/types'
import { t, type Dict } from '../../shared/i18n'
import { useLang } from '../../shared/i18n/lang'
import { LangSwitch } from '../../shared/ui/LangSwitch'
import { IconCheck, IconLoader } from '../../shared/ui/icons'
import { useTheme } from '../../shared/theme/theme'
import { isScene, type Phase } from './intro'
import { introStore, useIntro, type IntroStore } from './introStore'
import { LoginChrome } from './LoginChrome'
import { preloadLoginImages } from './loginAssets'
import { authStore, useAuth, type AuthError, type AuthStore } from './store'

interface Props {
  readonly store?: AuthStore
  readonly intro?: IntroStore
}

function errorText(error: AuthError | null, dict: Dict): string | null {
  if (error === 'invalid') return dict.loginFailed
  if (error === 'locked') return dict.loginLocked
  return error ? dict.loginNetwork : null
}

function useHealth(): Health | null {
  const [health, setHealth] = useState<Health | null>(null)
  useEffect(() => {
    let alive = true
    apiFetch<Health>('/api/health')
      .then((h) => alive && setHealth(h))
      .catch(() => alive && setHealth(null))
    return () => {
      alive = false
    }
  }, [])
  return health
}

/**
 * Sign-in UI (2026-10-25 design 09 "3D Terrain" / 10 "Daylight Glass"): top pills and one glass
 * card. It sits above the clouds; App places the background and the cloud layers around it.
 */
export function Login({ store = authStore, intro = introStore }: Props) {
  const [lang] = useLang()
  const dict = t(lang)
  const theme = useTheme()
  const auth = useAuth(store)
  const { phase } = useIntro(intro)
  const health = useHealth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const passwordRef = useRef<HTMLInputElement>(null)

  useEffect(() => preloadLoginImages(theme), [theme])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    // Read the live phase, not this render's: a double Enter must not send two logins.
    if (isScene(intro.getState().phase)) return
    intro.submit()
    await store.login(username, password)
    const ok = store.getState().status === 'authed'
    intro.authResult(ok)
    if (!ok) passwordRef.current?.focus()
  }
  const onChange = (set: (v: string) => void) => (v: string) => {
    set(v)
    store.clearError()
  }
  const error = phase === 'gather' ? null : errorText(auth.error, dict)
  const host = health?.hostname ?? '…'

  return (
    <div className="ls-ui" data-theme={theme}>
      <LoginChrome theme={theme} dev={health?.dev_mode === true} host={host} up={health !== null} dict={dict} />
      <form className="ls-card" aria-label={dict.login} onSubmit={onSubmit} data-error={error ? '' : undefined}>
        <CardHead dict={dict} />
        <label className="ls-field">
          {dict.username}
          <input className="ls-in" autoComplete="username" autoCapitalize="none" spellCheck={false} aria-invalid={error ? true : undefined} value={username} onChange={(e) => onChange(setUsername)(e.target.value)} />
        </label>
        <label className="ls-field">
          {dict.password}
          <input ref={passwordRef} className="ls-in" type="password" autoComplete="current-password" aria-invalid={error ? true : undefined} value={password} onChange={(e) => onChange(setPassword)(e.target.value)} />
        </label>
        <div className={`ls-err${error ? ' danger' : ''}`} role={error ? 'alert' : undefined} aria-live={error ? 'polite' : undefined}>
          {error}
        </div>
        <SubmitButton phase={phase} dict={dict} />
        <CardFoot dev={health?.dev_mode === true} dict={dict} />
      </form>
      <p className="ls-sr" aria-live="polite">
        {statusText(phase, dict)}
      </p>
      <span className="ls-credit">{dict.loginCredit}</span>
    </div>
  )
}

function statusText(phase: Phase, dict: Dict): string {
  if (phase === 'gather') return dict.loginSigningIn
  if (phase === 'done' || phase === 'clear') return dict.loginSignedIn
  return ''
}

function CardHead({ dict }: { readonly dict: Dict }) {
  return (
    <div className="ls-head">
      <h1 className="ls-title">{dict.login}</h1>
    </div>
  )
}

function SubmitButton({ phase, dict }: { readonly phase: Phase; readonly dict: Dict }) {
  const busy = phase === 'gather'
  const signed = phase === 'done' || phase === 'clear'
  return (
    <button className="ls-btn" type="submit" disabled={busy || signed}>
      {busy && <IconLoader size={18} className="ls-spin" />}
      {signed && <IconCheck size={18} />}
      <span>{busy ? dict.loginSigningIn : signed ? dict.loginSignedIn : dict.login}</span>
    </button>
  )
}

function CardFoot({ dev, dict }: { readonly dev: boolean; readonly dict: Dict }) {
  return (
    <div className="ls-foot">
      <span className="ls-note">
        {dev && (
          <>
            <span>{dict.devNote}</span>
            <span className="ls-cred">admin / admin</span>
          </>
        )}
      </span>
      <LangSwitch variant="login" />
    </div>
  )
}
