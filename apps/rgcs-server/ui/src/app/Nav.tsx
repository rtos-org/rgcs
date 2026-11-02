import type { Dict } from '../shared/i18n'
import { IconChat, IconGear, IconMap, IconMission, IconNetwork, IconVideo } from '../shared/ui/icons'
import { ENABLED_VIEWS, NAV_VIEWS, type View } from './view'

interface Props {
  readonly view: View
  readonly onView: (view: View) => void
  readonly dict: Dict
}

const LABEL: Record<(typeof NAV_VIEWS)[number], keyof Dict> = {
  ops: 'navMap',
  video: 'navVideo',
  mission: 'navMission',
  network: 'navNetwork',
  ai: 'navAi',
  maint: 'navSettings',
  present: 'navMap',
}

const ICON: Record<(typeof NAV_VIEWS)[number], () => React.ReactElement> = {
  ops: () => <IconMap />,
  video: () => <IconVideo />,
  mission: () => <IconMission />,
  network: () => <IconNetwork />,
  ai: () => <IconChat />,
  maint: () => <IconGear />,
  present: () => <IconMap />,
}

/** Six icon buttons with a sliding lens (`.seg.n6`, 344 px); labels live in `title` / `aria-label`. */
export function Nav({ view, onView, dict }: Props) {
  const index = Math.max(0, NAV_VIEWS.indexOf(view))
  return (
    <nav className="seg n6 nav" aria-label="views" style={{ width: 344, height: 40, flex: 'none' }}>
      <span className="lens" data-testid="lens" style={{ transform: `translateX(${index * 100}%)` }} />
      {NAV_VIEWS.map((v) => {
        const enabled = ENABLED_VIEWS.has(v)
        const label = dict[LABEL[v]]
        return (
          <button
            key={v}
            type="button"
            className={v === view ? 'on' : ''}
            aria-current={v === view ? 'page' : undefined}
            aria-disabled={enabled ? undefined : 'true'}
            aria-label={label}
            title={enabled ? label : `${label} (${dict.comingSoon})`}
            onClick={() => enabled && onView(v)}
          >
            {ICON[v]()}
          </button>
        )
      })}
    </nav>
  )
}
