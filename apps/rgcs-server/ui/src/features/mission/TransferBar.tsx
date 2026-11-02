import type { MissionTransfer } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { transferPercent } from './transfer'

/** Mission write progress (`mission_transfer`): shown while writing / verifying, gone afterwards. */
export function TransferBar({ transfer, dict }: { readonly transfer: MissionTransfer | null | undefined; readonly dict: Dict }) {
  if (!transfer || (transfer.phase !== 'write' && transfer.phase !== 'verify')) return null
  const pct = transferPercent(transfer)
  const label = transfer.phase === 'write' ? dict.transferWrite : dict.transferVerify
  return (
    <div className="transfer-bar" role="progressbar" aria-label={dict.mWriteMission} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span className="num">{`${label} ${transfer.done} / ${transfer.total}`}</span>
      <span className="bar">
        <span style={{ width: `${pct}%` }} />
      </span>
    </div>
  )
}
