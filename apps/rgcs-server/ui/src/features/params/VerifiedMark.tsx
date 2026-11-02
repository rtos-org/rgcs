import type { Dict } from '../../shared/i18n'
import { IconTick, IconWarn } from '../../shared/ui/icons'

/** A read-back result as a Lucide icon with its words, not a text glyph. */
export function VerifiedMark({ ok, dict }: { readonly ok: boolean; readonly dict: Dict }) {
  const label = ok ? dict.verifiedOk : dict.paramUnverified
  return (
    <span className={ok ? 'ok verified-mark' : 'warn verified-mark'} role="img" aria-label={label} title={label}>
      {ok ? <IconTick size={14} /> : <IconWarn size={14} />}
    </span>
  )
}
