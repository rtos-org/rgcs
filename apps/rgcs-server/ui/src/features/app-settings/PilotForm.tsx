// 操縦者: the signed-in user's 氏名 and 技能証明書番号 (used for flight drafts).
import { useEffect, useState } from 'react'
import type { PilotInput } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { getMyPilot, putMyPilot } from '../logbook/api'
import { firstIssue, pilotSchema } from '../logbook/schema'

interface Props {
  readonly dict: Dict
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function PilotForm({ dict }: Props) {
  const [draft, setDraft] = useState<PilotInput>({ full_name: '', license_no: '' })
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    getMyPilot()
      .then((p) => {
        if (!live) return
        setUsername(p.username)
        setDraft({ full_name: p.full_name, license_no: p.license_no })
      })
      .catch((e: unknown) => live && setError(message(e)))
    return () => {
      live = false
    }
  }, [])

  const save = async () => {
    const issue = firstIssue(pilotSchema.safeParse(draft))
    if (issue) return setError(`${issue.path}: ${issue.message}`)
    setBusy(true)
    setError(null)
    try {
      const p = await putMyPilot(draft)
      setDraft({ full_name: p.full_name, license_no: p.license_no })
      setSaved(true)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="surface" data-testid="pilot-card">
      <div className="h1">{`${dict.lbPilotInfo} · ${username}`}</div>
      <div className="lb-form">
        <label htmlFor="pilot-name">{dict.lbFullName}</label>
        <input id="pilot-name" className="in" value={draft.full_name} onChange={(e) => { setSaved(false); setDraft({ ...draft, full_name: e.target.value }) }} />
        <label htmlFor="pilot-license">{dict.lbLicense}</label>
        <input id="pilot-license" className="in" value={draft.license_no} onChange={(e) => { setSaved(false); setDraft({ ...draft, license_no: e.target.value }) }} />
      </div>
      {error && <div className="warnbox fatal">{error}</div>}
      {saved && <div className="warnbox">{dict.lbSaved}</div>}
      <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => void save()}>
        {dict.lbSave}
      </button>
    </div>
  )
}
