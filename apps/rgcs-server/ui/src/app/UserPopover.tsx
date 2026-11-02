import { useEffect } from 'react'
import type { Me } from '../shared/api/types'
import type { Dict } from '../shared/i18n'
import { IconUser } from '../shared/ui/icons'

interface Props {
  readonly me: Me
  readonly onLogout: () => void
  readonly onClose: () => void
  readonly onPresent?: () => void
  readonly dict: Dict
}

/** `.pop` under the username: avatar, name, role, audit note, buttons. */
export function UserPopover({ me, onLogout, onClose, onPresent, dict }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="g-strong pop" role="dialog" aria-label={me.username}>
      <div className="row pop-head">
        <span className="pop-avatar">
          <IconUser />
        </span>
        <div>
          <div className="pop-user">{me.username}</div>
          <div className="t3 pop-role">{me.role === 'admin' ? dict.roleAdmin : dict.roleOperator}</div>
        </div>
      </div>
      <div className="t3 pop-note">{dict.auditNote}</div>
      {onPresent && (
        <button type="button" className="btn" onClick={onPresent}>
          {dict.presentTitle}
        </button>
      )}
      <button type="button" className="btn" onClick={onLogout}>
        {dict.logout}
      </button>
    </div>
  )
}
