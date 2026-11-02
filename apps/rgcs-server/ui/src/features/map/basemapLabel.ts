import type { Basemap } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'

/** The built-in base maps (server defaults and the config example) by id. */
const BUILT_IN: Readonly<Record<string, keyof Dict>> = { map: 'bmMap', gsi_std: 'bmGsiStd', gsi_photo: 'bmGsiPhoto', satellite: 'bmSatellite' }

/** A built-in map's name in the UI language; a map from config.toml keeps its own label. */
export function basemapLabel(b: Basemap, dict: Dict): string {
  const key = BUILT_IN[b.id]
  return key ? dict[key] : b.label
}
