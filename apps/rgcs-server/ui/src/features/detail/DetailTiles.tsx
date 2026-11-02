// The three tiles of the right panel (prototype `.tile-btn` ×3): icon + label,
// with calibration attention on the tile itself (the pending-alert count stays on メッセージ).
import type { SysId } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconGrid, IconHistory, IconWrench } from '../../shared/ui/icons'

interface Props {
  readonly sysid: SysId
  readonly maintAttention: boolean
  readonly commandsOpen: boolean
  readonly dict: Dict
  readonly onOpenMaint?: (sysid: SysId) => void
  readonly onOpenLog: (sysid: SysId) => void
  readonly onOpenCommands: () => void
}

export function DetailTiles({ sysid, maintAttention, commandsOpen, dict, onOpenMaint, onOpenLog, onOpenCommands }: Props) {
  return (
    <div className="detail-tiles hair" data-testid="detail-tiles">
      <button type="button" className="tile-btn tile-l" title={dict.maintenance} disabled={!onOpenMaint} onClick={() => onOpenMaint?.(sysid)}>
        <IconWrench />
        <span className="tile-lbl">{dict.tileMaint}</span>
        {maintAttention && <span className="tile-dot" title={dict.calibAttention} />}
      </button>
      <button type="button" className="tile-btn tile-l" title={dict.tileHistory} onClick={() => onOpenLog(sysid)}>
        <IconHistory />
        <span className="tile-lbl">{dict.tileHistory}</span>
      </button>
      <button type="button" className={`tile-btn tile-l${commandsOpen ? ' on' : ''}`} title={dict.allCommands} aria-pressed={commandsOpen} onClick={onOpenCommands}>
        <IconGrid />
        <span className="tile-lbl">{dict.tileCommands}</span>
      </button>
    </div>
  )
}
