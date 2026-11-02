// The sign-in scene's layers (bottom to top): backdrop → [app] → clouds → login UI.
// The app mounts between them, so the backdrop and the overlay are two separate fixed layers.
import type { ReactNode } from 'react'
import type { Theme } from '../../shared/theme/theme'
import type { Phase } from './intro'
import { loginImages } from './loginAssets'

interface LayerProps {
  readonly theme: Theme
  readonly phase: Phase
}

/** Sky + tilted terrain (dark, design 09) or the full-bleed aerial photo (light, design 10). */
export function LoginBackdrop({ theme, phase }: LayerProps) {
  const { terrain } = loginImages(theme)
  return (
    <div className="ls-backdrop" data-theme={theme} data-phase={phase} aria-hidden="true">
      {theme === 'dark' ? (
        <>
          <div className="ls-ground">
            <img className="ls-terrain" src={terrain} alt="" decoding="async" />
          </div>
          <div className="ls-fog" />
        </>
      ) : (
        <>
          <img className="ls-map" src={terrain} alt="" decoding="async" />
          <div className="ls-wash" />
        </>
      )}
    </div>
  )
}

/** Thin + dense clouds (each in a drifting wrapper) and the haze; never takes pointer events. */
export function CloudLayer({ theme, phase }: LayerProps) {
  const { thin, dense } = loginImages(theme)
  return (
    <div className="ls-clouds" data-theme={theme} data-phase={phase} aria-hidden="true">
      <div className="ls-drift ls-drift-thin">
        <img className="ls-cloud ls-thin" src={thin} alt="" decoding="async" />
      </div>
      <div className="ls-drift ls-drift-dense">
        <img className="ls-cloud ls-dense" src={dense} alt="" decoding="async" />
      </div>
      <div className="ls-haze" />
      {/* Light sign-in, dark app: the light haze hands over to a dusk tone before it clears. */}
      {theme === 'light' && <div className="ls-haze ls-haze-dusk" />}
    </div>
  )
}

interface OverlayProps extends LayerProps {
  readonly reduced: boolean
  readonly children: ReactNode
}

/** Clouds + the login UI above the app. Reduced motion draws no clouds at all. */
export function LoginOverlay({ theme, phase, reduced, children }: OverlayProps) {
  return (
    <div className="ls-overlay" data-theme={theme} data-phase={phase} data-reduced={reduced ? '' : undefined}>
      {!reduced && <CloudLayer theme={theme} phase={phase} />}
      {children}
    </div>
  )
}
