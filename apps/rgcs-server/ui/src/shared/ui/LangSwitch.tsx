// The UI language picker (login card and the settings tab): every language under its own name.
import { LANGS, useLang } from '../i18n/lang'
import type { Lang } from '../i18n'

const NAMES: Readonly<Record<Lang, string>> = { en: 'English', ja: '日本語', zh: '简体中文', ko: '한국어' }

/** `seg`: the settings segmented control; `login`: the login card's pill. */
export function LangSwitch({ variant }: { readonly variant: 'seg' | 'login' }) {
  const [lang, setLang] = useLang()
  const at = Math.max(0, LANGS.indexOf(lang))
  const login = variant === 'login'
  return (
    <div className={login ? 'ls-seg lang4' : 'seg lang lang4'} role="group" aria-label="language">
      <span className={login ? 'ls-lens' : 'lens'} style={{ transform: `translateX(${at * 100}%)` }} />
      {LANGS.map((l) => (
        <button key={l} type="button" lang={l} className={l === lang ? 'on' : ''} aria-pressed={l === lang} onClick={() => setLang(l)}>
          {NAMES[l]}
        </button>
      ))}
    </div>
  )
}
