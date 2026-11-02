import type { Dict } from '../../shared/i18n'
import { IconPower, IconPowerOff } from '../../shared/ui/icons'

/** The arm state in words and an icon, never colour alone. */
export function ArmChip({ armed, dict }: { readonly armed: boolean; readonly dict: Dict }) {
  return (
    <span className={armed ? 'arm-chip on' : 'arm-chip'}>
      {armed ? <IconPower size={12} /> : <IconPowerOff size={12} />}
      {armed ? dict.armedState : dict.disarmedState}
    </span>
  )
}
