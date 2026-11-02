import type { Severity } from '../../shared/api/types'
import { IconError, IconInfo, IconOk, IconWarn } from '../../shared/ui/icons'

const ICON = {
  info: IconInfo,
  ok: IconOk,
  warn: IconWarn,
  error: IconError,
} as const

/** Severity icon (prototype `SEV`): info / circle-check / triangle-alert / octagon-x, coloured `sev-*`. */
export function SevIcon({ severity, size }: { readonly severity: Severity; readonly size: number }) {
  const Icon = ICON[severity]
  return <Icon size={size} className={`sev-${severity}`} />
}
