import type { Dict } from '../../shared/i18n'
import type { Theme } from '../../shared/theme/theme'

interface Props {
  readonly theme: Theme
  readonly dev: boolean
  readonly host: string
  readonly up: boolean
  readonly dict: Dict
}

/** The sign-in screen's top corners: brand + DEV badge on the left, the server pill on the right. */
export function LoginChrome({ theme, dev, host, up, dict }: Props) {
  return (
    <>
      <div className={`ls-brand${theme === 'light' ? ' ls-pill' : ''}`}>
        <span className="ls-logo">RGCS</span>
        {dev && <span className="ls-dev">{dict.devBadge}</span>}
      </div>
      {/* the server pill in both themes; no inert 2D / 3D chip */}
      <div className="ls-host ls-pill" title={`${dict.loginServer}: ${host} · ${up ? dict.loginServerUp : dict.loginServerUnknown}`}>
        <span className={`ls-dot${up ? ' up' : ''}`} aria-hidden="true" />
        <span className="ls-hostname">{host}</span>
      </div>
    </>
  )
}
