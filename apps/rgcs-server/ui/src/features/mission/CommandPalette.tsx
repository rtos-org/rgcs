import type { Dict } from '../../shared/i18n'
import { IconClose, IconFileUp, IconSurvey } from '../../shared/ui/icons'
import type { VehicleKind } from '../../shared/api/types'
import { CMDS, SURVEY_KEY, isSurveyKey, mavFontSize, paletteFor } from './cmds'
import { wpLabel } from './labels'

interface Props {
  readonly where: string
  /** The write target's airframe: commands it does not fly are left out (null: all). */
  readonly kind?: VehicleKind | null
  readonly vtol?: boolean
  readonly dict: Dict
  readonly onInsert: (key: string) => void
  readonly onClose: () => void
}

const GROUPS = [
  { key: 'pos', label: 'mPalPos', color: 'var(--accent)', radius: '50%' },
  { key: 'do', label: 'mPalDo', color: 'rgba(255,255,255,.25)', radius: '4px' },
  { key: 'cond', label: 'mPalCond', color: 'rgba(255,255,255,.25)', radius: '4px' },
] as const

/** Prototype "コマンドを挿入" palette: drops over the list, three groups, 2-column buttons. */
export function CommandPalette({ where, kind = null, vtol = false, dict, onInsert, onClose }: Props) {
  const palette = paletteFor(kind, vtol)
  return (
    <div className="g-strong cmd-palette" role="dialog" aria-label={dict.mInsertCmd}>
      <div className="row hair" style={{ padding: '10px 14px' }}>
        <span className="h2">{dict.mInsertCmd}</span>
        <span className="t3" style={{ fontSize: 12, marginLeft: 10 }}>
          {where}
        </span>
        <div className="grow" />
        <button type="button" className="btn-icon sm" aria-label={dict.close} onClick={onClose}>
          <IconClose size={16} />
        </button>
      </div>
      <div className="cmd-palette-body">
        {GROUPS.map((g) => (
          <div key={g.key}>
            <div className="t3" style={{ fontSize: 12, padding: '4px 4px 6px' }}>
              {dict[g.label]}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {palette[g.key].map((k) => (isSurveyKey(k) ? <SurveyButton key={k} k={k} dict={dict} onInsert={onInsert} /> : <CmdButton key={k} k={k} radius={g.radius} color={g.color} dict={dict} onInsert={onInsert} />))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CmdButton({ k, radius, color, dict, onInsert }: { k: string; radius: string; color: string; dict: Dict; onInsert: (key: string) => void }) {
  return (
    <button type="button" className="cmd-btn pal" title={CMDS[k]?.mav} onClick={() => onInsert(k)}>
      <span style={{ width: 16, height: 16, borderRadius: radius, background: k === 'DO_SET_ROI' ? 'var(--ok)' : color, flex: 'none' }} />
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="ell">{wpLabel(k, dict)}</span>
        <span className="mono t4 ell" style={{ fontSize: mavFontSize((CMDS[k]?.mav ?? '').replace('MAV_CMD_', '')) }}>
          {(CMDS[k]?.mav ?? '').replace('MAV_CMD_', '')}
        </span>
      </span>
    </button>
  )
}

/** サーベイ (draw an area) / KML から読み込む: not commands, so nothing here reads CMDS. */
function SurveyButton({ k, dict, onInsert }: { k: string; dict: Dict; onInsert: (key: string) => void }) {
  const draw = k === SURVEY_KEY
  return (
    <button type="button" className="cmd-btn pal sv-pal" onClick={() => onInsert(k)}>
      {draw ? <IconSurvey size={16} /> : <IconFileUp size={16} />}
      <span className="ell">{draw ? dict.svPalSurvey : dict.svPalKml}</span>
    </button>
  )
}
