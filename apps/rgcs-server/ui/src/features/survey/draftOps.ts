// Survey grids in the editor draft: a survey tags a contiguous run of items by uid. These ops are the
// only edits that may change a survey's items; `reconcileSurveys` drops a survey any other edit touched.
import type { MissionItem } from '../../shared/api/types'
import { insertItemsAfter, type Draft, type DraftSurvey } from '../mission/model'
import type { SurveySpec } from './spec'

export function surveyAt(d: Draft, uid: number): DraftSurvey | null {
  return d.surveys.find((s) => s.uids.includes(uid)) ?? null
}

/** Where an insert "after `uid`" goes: after the whole survey when `uid` lies inside one. */
export function insertAnchor(d: Draft, uid: number | null): number | null {
  return uid === null ? null : (surveyAt(d, uid)?.uids.at(-1) ?? uid)
}

/** Inserts the generated `items` (fresh uids) after `afterUid` — after the whole survey when it lies inside one — or at the end. */
export function addSurvey(d: Draft, afterUid: number | null, spec: SurveySpec, items: readonly MissionItem[]): { draft: Draft; id: string } {
  const { draft, uids } = insertItemsAfter(d, insertAnchor(d, afterUid), items)
  const id = crypto.randomUUID()
  return { draft: { ...draft, surveys: [...d.surveys, { id, uids, spec }] }, id }
}

/** Replaces the survey's items in place with `items` (fresh uids) and its spec; unknown ids leave the draft alone. */
export function regenerateSurvey(d: Draft, id: string, spec: SurveySpec, items: readonly MissionItem[]): Draft {
  const survey = d.surveys.find((s) => s.id === id)
  if (!survey) return d
  const old = new Set(survey.uids)
  const at = d.items.findIndex((it) => old.has(it.uid))
  if (at < 0) return d
  const copies = items.map((it, i) => ({ ...it, uid: d.nextUid + i }))
  const rest = d.items.filter((it) => !old.has(it.uid))
  const next = { id, uids: copies.map((c) => c.uid), spec }
  return {
    ...d,
    items: [...rest.slice(0, at), ...copies, ...rest.slice(at)],
    surveys: d.surveys.map((s) => (s === survey ? next : s)),
    nextUid: d.nextUid + copies.length,
  }
}

/** Deletes the survey: its items and its tag, in one edit; unknown ids leave the draft alone. */
export function removeSurvey(d: Draft, id: string): Draft {
  const survey = d.surveys.find((s) => s.id === id)
  if (!survey) return d
  const gone = new Set(survey.uids)
  return { ...d, items: d.items.filter((it) => !gone.has(it.uid)), surveys: d.surveys.filter((s) => s !== survey) }
}

/** Deletes `uids`; a survey any of them belongs to goes as a whole (items and tag). */
export function removeWithSurveys(d: Draft, uids: ReadonlySet<number>): Draft {
  if (uids.size === 0) return d
  const hit = d.surveys.filter((s) => s.uids.some((uid) => uids.has(uid)))
  const gone = new Set([...uids, ...hit.flatMap((s) => s.uids)])
  return { ...d, items: d.items.filter((it) => !gone.has(it.uid)), surveys: d.surveys.filter((s) => !hit.includes(s)) }
}

/** Removes the tag: the items stay as plain mission items. */
export function expandSurvey(d: Draft, id: string): Draft {
  const surveys = d.surveys.filter((s) => s.id !== id)
  return surveys.length === d.surveys.length ? d : { ...d, surveys }
}

/**
 * A survey `next` shares (same object) with `prev` was not edited by a survey op, so it is kept only
 * while its items are present, contiguous, in order and untouched (reference-equal to `prev`'s).
 * A survey object an op made is trusted. Returns the names of the surveys dropped.
 */
export function reconcileSurveys(prev: Draft, next: Draft): { draft: Draft; dropped: string[] } {
  if (next.surveys.length === 0) return { draft: next, dropped: [] }
  const before = new Set(prev.surveys)
  const prevItems = new Map(prev.items.map((it) => [it.uid, it]))
  const index = new Map(next.items.map((it, i) => [it.uid, i]))
  const intact = (s: DraftSurvey): boolean => {
    const at = index.get(s.uids[0] ?? -1)
    if (at === undefined) return false
    return s.uids.every((uid, k) => {
      const it = next.items[at + k]
      return it !== undefined && it.uid === uid && it === prevItems.get(uid)
    })
  }
  const kept = next.surveys.filter((s) => !before.has(s) || intact(s))
  if (kept.length === next.surveys.length) return { draft: next, dropped: [] }
  const dropped = next.surveys.filter((s) => !kept.includes(s)).map((s) => s.spec.name)
  return { draft: { ...next, surveys: kept }, dropped }
}
