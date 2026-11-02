// 記事 (squawk) entry for one flight: 発生年月日 / 不具合事項 / 処置年月日 / 処置その他 / 確認者.
import { useState } from 'react'
import type { FlightSquawkInput } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { firstIssue, squawkSchema } from './schema'

const EMPTY: FlightSquawkInput = { occurred_on: '', description: '', action_on: '', action: '', confirmer: '' }

interface Props {
  readonly dict: Dict
  readonly busy: boolean
  readonly onAdd: (input: FlightSquawkInput) => Promise<void>
}

export function SquawkForm({ dict, busy, onAdd }: Props) {
  const [draft, setDraft] = useState<FlightSquawkInput>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<FlightSquawkInput>) => setDraft((d) => ({ ...d, ...patch }))
  const submit = async () => {
    const issue = firstIssue(squawkSchema.safeParse(draft))
    if (issue) return setError(`${issue.path}: ${issue.message}`)
    setError(null)
    await onAdd(draft)
    setDraft(EMPTY)
  }
  return (
    <div className="lb-form">
      <label htmlFor="sq-date">{dict.lbSquawkDate}</label>
      <input id="sq-date" className="in" type="date" value={draft.occurred_on} onChange={(e) => set({ occurred_on: e.target.value })} />
      <label htmlFor="sq-text">{dict.lbSquawkText}</label>
      <input id="sq-text" className="in" value={draft.description} onChange={(e) => set({ description: e.target.value })} />
      <label htmlFor="sq-action-date">{dict.lbActionDate}</label>
      <input id="sq-action-date" className="in" type="date" value={draft.action_on} onChange={(e) => set({ action_on: e.target.value })} />
      <label htmlFor="sq-action">{dict.lbAction}</label>
      <input id="sq-action" className="in" value={draft.action} onChange={(e) => set({ action: e.target.value })} />
      <label htmlFor="sq-confirmer">{dict.lbConfirmer}</label>
      <input id="sq-confirmer" className="in" value={draft.confirmer} onChange={(e) => set({ confirmer: e.target.value })} />
      {error && <div className="warnbox fatal" style={{ gridColumn: '1 / -1' }}>{error}</div>}
      <span />
      <div>
        <button type="button" className="btn sm" disabled={busy} onClick={() => void submit()}>
          {dict.lbAddSquawk}
        </button>
      </div>
    </div>
  )
}
