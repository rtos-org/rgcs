// The planner's map guide (マップ操作ガイド): gestures, path colours and shortcuts.
import type { Dict } from '../../shared/i18n'
import { IconClose } from '../../shared/ui/icons'

export function HelpPanel({ dict, onClose }: { readonly dict: Dict; readonly onClose: () => void }) {
  return (
    <div className="g-strong float map-r top2 help-panel" role="dialog" aria-label={dict.mHelpTitle}>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="h2">{dict.mHelpTitle}</span>
        <div className="grow" />
        <button type="button" className="btn-icon sm" aria-label={dict.close} onClick={onClose}>
          <IconClose size={16} />
        </button>
      </div>
      <div className="help-grid">
        {([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const).map((n) => (
          <HelpRow key={n} k={dict[`mHelp${n}k` as keyof Dict]} v={dict[`mHelp${n}v` as keyof Dict]} />
        ))}
      </div>
      <div className="t4" style={{ marginTop: 10, fontSize: 11 }}>
        {dict.mShortcuts}
      </div>
    </div>
  )
}

function HelpRow({ k, v }: { readonly k: string; readonly v: string }) {
  return (
    <>
      <span className="mono" style={{ whiteSpace: 'nowrap', color: 'var(--accent)', fontSize: 11 }}>
        {k}
      </span>
      <span className="t2" style={{ lineHeight: 1.4 }}>
        {v}
      </span>
    </>
  )
}
