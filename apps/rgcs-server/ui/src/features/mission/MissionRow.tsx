import type { HTMLAttributes, MouseEvent } from 'react'
import type { Dict } from '../../shared/i18n'
import { IconChevronDown, IconChevronUp } from '../../shared/ui/icons'
import { CMDS, mavFontSize } from './cmds'
import { wpLabel } from './labels'
import { badgeText } from './mapEdit'
import { cmdKey, type DraftItem } from './model'

interface Props {
  readonly item: DraftItem
  /** 1-based mission sequence. */
  readonly seq: number
  readonly sel: boolean
  readonly sub: string
  readonly dict: Dict
  readonly className?: string
  /** Drag & drop and context-menu handlers; absent on a survey's read-only items. */
  readonly attrs?: HTMLAttributes<HTMLDivElement>
  /** Up / down buttons; absent on a survey's read-only items. */
  readonly reorder?: { readonly canUp: boolean; readonly canDown: boolean; readonly onReorder: (dir: -1 | 1) => void }
  readonly onClick: (e: MouseEvent<HTMLDivElement>) => void
}

/** Prototype `.wrow`: badge, Japanese command name + MAV id, summary line, up / down. */
export function WpRow({ item, seq, sel, sub, dict, className = '', attrs, reorder, onClick }: Props) {
  const key = cmdKey(item)
  const spec = CMDS[key]
  const pos = spec?.pos === true
  const roi = key === 'DO_SET_ROI'
  return (
    <div
      className={`wrow${sel ? ' sel' : ''}${className}`}
      onContextMenu={(e) => e.preventDefault()}
      {...attrs}
      role="option"
      aria-selected={sel}
      data-seq={seq}
      style={{ paddingLeft: pos ? 12 : 28 }}
      onClick={onClick}
    >
      <span className={`wbadge${sel ? ' sel' : pos ? ' pos' : ''}${roi ? ' roi' : key === 'RTL' ? ' rtl' : ''}`} style={{ borderRadius: pos ? '50%' : 6 }}>
        {badgeText(seq, key)}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
          <span className="ell cmd-label">{wpLabel(key, dict)}</span>
          <span className="mono t3 mav" title={`${spec?.mav ?? key} (#${item.command})`} style={{ flex: 'none', fontSize: mavFontSize(spec?.mav ?? key), lineHeight: 1 }}>
            {spec?.mav ?? `#${item.command}`}
          </span>
        </div>
        <div className="t3 num ell sub" style={{ fontSize: 11 }}>
          {sub}
        </div>
      </div>
      {reorder && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <button type="button" className="updown" aria-label={dict.mUp} disabled={!reorder.canUp} onClick={(e) => (e.stopPropagation(), reorder.onReorder(-1))}>
            <IconChevronUp size={12} />
          </button>
          <button type="button" className="updown" aria-label={dict.mDown} disabled={!reorder.canDown} onClick={(e) => (e.stopPropagation(), reorder.onReorder(1))}>
            <IconChevronDown size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
