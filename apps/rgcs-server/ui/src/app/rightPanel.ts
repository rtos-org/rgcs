// Nav ↔ right-panel state (prototype `toggleAi` / `goOps`): the AI
// chat is a right panel on the ops map, not a view of its own.
import type { View } from './view'

export type RightPanel = 'detail' | 'ai'

export interface Place {
  readonly view: View
  readonly right: RightPanel
}

/** Where a nav press leads: `ai` toggles the AI panel on the ops map, `ops` shows the detail panel. */
export function navigate(p: Place, target: View): Place {
  if (target === 'ai') return p.view === 'ops' && p.right === 'ai' ? { view: 'ops', right: 'detail' } : { view: 'ops', right: 'ai' }
  if (target === 'ops') return { view: 'ops', right: 'detail' }
  return { view: target, right: p.right }
}

/** The view the nav lens marks: `ai` while the AI panel shows on the ops map. */
export function navViewOf(p: Place): View {
  return p.view === 'ops' && p.right === 'ai' ? 'ai' : p.view
}
