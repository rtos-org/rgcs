// A survey in the mission list: one collapsible group row (`サーベイ {name} · {n} WP · {photos} 枚`)
// over its items, which are shown read-only with their mission sequence numbers.
import { useMemo, type HTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import type { Dict } from '../../shared/i18n'
import { IconChevron, IconSurvey } from '../../shared/ui/icons'
import { hasPosition, type LatLon } from '../mission/geo'
import type { DraftItem, DraftSurvey } from '../mission/model'
import { generateSurvey, surveyNumbers } from './generate'
import type { SurveySpec } from './spec'

export type ListSegment = { readonly kind: 'item'; readonly index: number } | { readonly kind: 'survey'; readonly survey: DraftSurvey; readonly first: number }

/** Splits the list into plain items and survey groups (a survey whose items are not contiguous here stays plain). */
export function listSegments(items: readonly DraftItem[], surveys: readonly DraftSurvey[]): ListSegment[] {
  const starts = new Map(surveys.map((s) => [s.uids[0], s]))
  const out: ListSegment[] = []
  for (let i = 0; i < items.length; ) {
    const s = starts.get(items[i]!.uid)
    if (s && s.uids.every((uid, k) => items[i + k]?.uid === uid)) {
      out.push({ kind: 'survey', survey: s, first: i })
      i += s.uids.length
    } else {
      out.push({ kind: 'item', index: i })
      i += 1
    }
  }
  return out
}

/** Photo count for the row; null when the spec yields no lanes. */
function usePhotos(spec: SurveySpec, home: LatLon | null): number | null {
  const [lat, lon] = [home?.lat, home?.lon]
  return useMemo(() => {
    const gen = generateSurvey(spec, lat === undefined || lon === undefined ? null : { lat, lon })
    return 'error' in gen ? null : surveyNumbers(spec, gen.geometry, gen.items).photos
  }, [spec, lat, lon])
}

interface Props {
  readonly survey: DraftSurvey
  /** The survey's items, in mission order. */
  readonly items: readonly DraftItem[]
  readonly home: LatLon | null
  readonly dict: Dict
  /** One of its items is selected. */
  readonly sel: boolean
  readonly open: boolean
  readonly onToggle: () => void
  /** Drag & drop of the whole group, plus drop markers. */
  readonly headAttrs: HTMLAttributes<HTMLDivElement>
  readonly headClass: string
  readonly onHeadClick: (e: MouseEvent<HTMLDivElement>) => void
  readonly renderItem: (it: DraftItem, k: number) => ReactNode
}

export function SurveyRow({ survey, items, home, dict, sel, open, onToggle, headAttrs, headClass, onHeadClick, renderItem }: Props) {
  const photos = usePhotos(survey.spec, home)
  const text = dict.svRow
    .replace('{name}', survey.spec.name)
    .replace('{n}', String(items.filter(hasPosition).length))
    .replace('{photos}', photos === null ? '—' : String(photos))
  return (
    <div className="sv-group" role="group" aria-label={text} data-testid="survey-row">
      <div className={`wrow sv-head${sel ? ' sel' : ''}${headClass}`} data-testid="survey-head" onContextMenu={(e) => e.preventDefault()} {...headAttrs} onClick={onHeadClick}>
        <span className={`wbadge sv-badge${sel ? ' sel' : ''}`}>
          <IconSurvey size={14} />
        </span>
        <span className="ell cmd-label sv-head-text">{text}</span>
        <button
          type="button"
          className={`btn-icon sm sv-toggle${open ? ' open' : ''}`}
          aria-label={dict.svRowToggle}
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
        >
          <IconChevron size={16} />
        </button>
      </div>
      {open && items.map(renderItem)}
    </div>
  )
}
