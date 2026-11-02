// Which survey items the map gives a badge: a survey is hundreds of items whose badges would bury
// its vertex handles, so only a survey item picked on its own (from the expanded list) shows its
// badge, and none of them is ever dragged.
import { surveyLocked, type Draft } from './model'

export interface SurveyBadges {
  /** Survey items: badges never draggable. */
  readonly locked: ReadonlySet<number>
  /** Survey items not themselves selected: no badge at all. */
  readonly hidden: ReadonlySet<number>
}

export function surveyBadges(d: Draft, selected: ReadonlySet<number>): SurveyBadges {
  const hidden = new Set(d.surveys.flatMap((s) => s.uids).filter((uid) => !selected.has(uid)))
  return { locked: surveyLocked(d), hidden }
}
