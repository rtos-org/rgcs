export type View = 'ops' | 'video' | 'mission' | 'network' | 'ai' | 'maint' | 'present'

/** Order of the six header buttons (2026-10-18). `present` is a separate route, not a tab. */
export const NAV_VIEWS: readonly View[] = ['ops', 'video', 'mission', 'network', 'ai', 'maint']

/**
 * Nav buttons that are enabled; the rest render disabled. `ai` opens the AI panel on the ops map
 * (`rightPanel.navigate`), so `view` itself is never set to `'ai'`.
 */
export const ENABLED_VIEWS: ReadonlySet<View> = new Set<View>(['ops', 'video', 'mission', 'network', 'ai', 'maint'])
