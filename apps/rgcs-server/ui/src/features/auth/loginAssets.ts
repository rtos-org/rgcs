// Sign-in images, bundled as hashed Vite assets (dist/assets/, cached immutable by rgcs-server).
// Clouds: scripts/gen_clouds.py; terrain: scripts/gen_login_bg.py (GSI seamless aerial photo).
import type { Theme } from '../../shared/theme/theme'
import cloudDenseDay from './assets/cloud_dense_day.webp'
import cloudDenseDusk from './assets/cloud_dense_dusk.webp'
import cloudThinDay from './assets/cloud_thin_day.webp'
import cloudThinDusk from './assets/cloud_thin_dusk.webp'
import terrain from './assets/terrain.webp'

export interface LoginImages {
  readonly thin: string
  readonly dense: string
  readonly terrain: string
}

/** Light uses the `*_day` clouds, dark the `*_dusk` ones. */
export function loginImages(theme: Theme): LoginImages {
  return theme === 'light' ? { thin: cloudThinDay, dense: cloudDenseDay, terrain } : { thin: cloudThinDusk, dense: cloudDenseDusk, terrain }
}

// Decoded images are held here so the browser keeps them ready for the first transition.
const held = new Map<string, HTMLImageElement>()

/** Fetches and decodes the theme's clouds while the operator types, so `gather` never waits on a decode. */
export function preloadLoginImages(theme: Theme): void {
  if (typeof Image === 'undefined') return
  const { thin, dense } = loginImages(theme)
  for (const src of [thin, dense]) {
    if (held.has(src)) continue
    const img = new Image()
    img.decoding = 'async'
    img.src = src
    held.set(src, img)
    img.decode?.().catch(() => held.delete(src))
  }
}
