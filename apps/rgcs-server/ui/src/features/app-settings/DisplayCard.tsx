import type { Dict } from '../../shared/i18n'
import { useThemePref, type ThemePref } from '../../shared/theme/theme'

const ORDER: readonly ThemePref[] = ['auto', 'dark', 'light']

/** 表示 (2026-10-25): 自動 / ダーク / ライト, stored per browser. Applies to the sign-in screen. */
export function DisplayCard({ dict }: { readonly dict: Dict }) {
  const [pref, setPref] = useThemePref()
  const label: Record<ThemePref, string> = { auto: dict.themeAuto, dark: dict.themeDark, light: dict.themeLight }
  return (
    <div className="surface" data-testid="display-card">
      <div className="h1">{dict.themeTitle}</div>
      <div className="seg n3 theme" role="group" aria-label={dict.themeTitle}>
        <span className="lens" style={{ transform: `translateX(${ORDER.indexOf(pref) * 100}%)` }} />
        {ORDER.map((p) => (
          <button key={p} type="button" className={pref === p ? 'on' : ''} aria-pressed={pref === p} onClick={() => setPref(p)}>
            {label[p]}
          </button>
        ))}
      </div>
      <div className="t3" style={{ fontSize: 12 }}>
        {dict.themeNote}
      </div>
    </div>
  )
}
