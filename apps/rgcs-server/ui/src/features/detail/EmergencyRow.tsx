import type { ReactElement } from 'react'
import type { VehicleCommand, VehicleState } from '../../shared/api/types'
import { cmdLabel, type Dict } from '../../shared/i18n'
import { IconHouse, IconLand, IconPause } from '../../shared/ui/icons'
import type { BtnState } from '../commands'

interface Props {
  readonly vehicle: VehicleState
  readonly dict: Dict
  readonly onCommand: (command: VehicleCommand) => void
  readonly feedback?: (cmd: string) => BtnState | null
}

const BUTTONS: readonly { cmd: 'pause' | 'rtl' | 'land'; icon: () => ReactElement }[] = [
  { cmd: 'pause', icon: () => <IconPause /> },
  { cmd: 'rtl', icon: () => <IconHouse size={18} /> },
  { cmd: 'land', icon: () => <IconLand /> },
]

/** Always-visible 一時停止 / 帰還 / 着陸 (operator proposal 1); a rover has no 着陸. A lost link only marks them: a frame may still get through. */
export function EmergencyRow({ vehicle, dict, onCommand, feedback }: Props) {
  const stale = vehicle.link === 'lost'
  const buttons = vehicle.kind === 'rover' ? BUTTONS.filter((b) => b.cmd !== 'land') : BUTTONS
  return (
    <div className="emerg-row hair" role="group" aria-label={dict.emergency}>
      {buttons.map(({ cmd, icon }) => {
        const fb = feedback?.(cmd) ?? null
        return (
          <button key={cmd} type="button" aria-label={cmdLabel(cmd, dict)} className={`emerg-btn${cmd === 'pause' ? ' primary' : ''}${stale ? ' stale' : ''}${fb ? ` ${fb}` : ''}`} onClick={() => onCommand({ cmd })}>
            <span aria-hidden="true">{icon()}</span>
            <span>{cmdLabel(cmd, dict)}</span>
          </button>
        )
      })}
    </div>
  )
}
