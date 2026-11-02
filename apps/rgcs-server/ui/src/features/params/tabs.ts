import type { Dict } from '../../shared/i18n'

export type MaintTab = 'params' | 'calib' | 'daily' | 'logbook' | 'history' | 'inspector' | 'app'
/** Addendum §5.7 + the MAVLink inspector (2026-10-19); 点検・校正 is live since 2026-10-20. */
export const MAINT_TABS: readonly MaintTab[] = ['params', 'calib', 'daily', 'logbook', 'history', 'inspector', 'app']
export const ENABLED_TABS: ReadonlySet<MaintTab> = new Set<MaintTab>(MAINT_TABS)

export const TAB_LABEL: Record<MaintTab, keyof Dict> = {
  params: 'tabParams',
  calib: 'tabCalib',
  daily: 'tabDaily',
  logbook: 'tabLogbook',
  history: 'tabHistory',
  inspector: 'tabInspector',
  app: 'tabApp',
}
