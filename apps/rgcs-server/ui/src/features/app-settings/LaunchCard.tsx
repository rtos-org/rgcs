import type { ReactNode } from 'react'
import type { Dict } from '../../shared/i18n'

interface Props {
  readonly testId: string
  readonly icon: ReactNode
  readonly title: string
  readonly note: string
  readonly dict: Dict
  readonly onOpen: () => void
}

/** A card that opens a settings sheet (実験機能, 外的要因データ). */
export function LaunchCard({ testId, icon, title, note, dict, onOpen }: Props) {
  return (
    <div className="surface launch-card" data-testid={testId}>
      <div className="row launch-card-head">
        {icon}
        <div className="h1">{title}</div>
      </div>
      <div className="t3" style={{ fontSize: 12 }}>
        {note}
      </div>
      <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={onOpen}>
        {dict.settingsOpen}
      </button>
    </div>
  )
}
