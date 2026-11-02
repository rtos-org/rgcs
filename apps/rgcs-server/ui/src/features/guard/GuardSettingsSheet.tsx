// 実験機能 sheet: the AI 緊急介入 switch with the 3-part consent dialog, the
// per-event level, and the countdown / takeover wait. Admin only; operators see the state read-only.
// Every request comes from a click (Review Focus 1), except the initial GET.
import { useEffect, useState } from 'react'
import { ApiError } from '../../shared/api/client'
import type { GuardConsent, GuardSettings } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { dateTimeText } from '../../shared/format/time'
import { IconCheck, IconClose, IconFlask } from '../../shared/ui/icons'
import { getGuardSettings, putGuardSettings, type ConsentAnswer, type GuardSettingsPut } from './api'
import { ConsentDialog } from './ConsentDialog'
import { GuardTimes } from './GuardTimes'
import { LevelSelect } from './LevelSelect'

interface Props {
  readonly isAdmin: boolean
  readonly dict: Dict
  readonly onClose: () => void
}

type Consenting = 'none' | 'enable' | 'update'

/** A known refusal code in the user's language, else the server's own message. */
export function refusalText(e: unknown, dict: Dict): string {
  if (e instanceof ApiError) {
    const known = (dict as Record<string, string | undefined>)[`guard_${e.code}`]
    return known ?? e.message
  }
  return e instanceof Error ? e.message : String(e)
}

export function GuardSettingsSheet({ isAdmin, dict, onClose }: Props) {
  const [settings, setSettings] = useState<GuardSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [consenting, setConsenting] = useState<Consenting>('none')
  const [askDisable, setAskDisable] = useState(false)

  useEffect(() => {
    getGuardSettings()
      .then(setSettings)
      .catch((e: unknown) => setError(refusalText(e, dict)))
  }, [dict])

  const apply = async (put: GuardSettingsPut): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      setSettings(await putGuardSettings(put))
      return true
    } catch (e: unknown) {
      setError(refusalText(e, dict))
      return false
    } finally {
      setBusy(false)
    }
  }
  const consent = async (c: ConsentAnswer) => {
    const put = consenting === 'enable' ? { enabled: true, consent: c } : { consent: c }
    if (await apply(put)) setConsenting('none')
  }
  const disable = async () => {
    if (await apply({ enabled: false })) setAskDisable(false)
  }

  return (
    <div className="modal-backdrop">
      <div className="g-strong confirm guard-settings" role="dialog" aria-label={dict.guardTitle}>
        <div className="row guard-head">
          <IconFlask size={18} />
          <div className="h2">{dict.guardTitle}</div>
        </div>
        <section className="inset guard-feature">
          <FeatureHeader settings={settings} isAdmin={isAdmin} busy={busy} dict={dict} onEnable={() => setConsenting('enable')} onDisable={() => setAskDisable(true)} />
          {askDisable && <DisableConfirm dict={dict} busy={busy} onYes={() => void disable()} onNo={() => setAskDisable(false)} />}
          {settings?.enabled && <ConsentSummary consent={settings.consent} isAdmin={isAdmin} dict={dict} onReview={() => setConsenting('update')} />}
        </section>
        {settings?.enabled && <EnabledBody settings={settings} isAdmin={isAdmin} busy={busy} dict={dict} apply={apply} />}
        {!isAdmin && <div className="t3 guard-note">{dict.lbAdminOnly}</div>}
        {error && (
          <div className="hint caution guard-error" role="alert">
            {error}
          </div>
        )}
        <div className="confirm-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {dict.close}
          </button>
        </div>
      </div>
      {consenting !== 'none' && settings && (
        <ConsentDialog
          dict={dict}
          busy={busy}
          initial={consenting === 'update' ? settings.consent : undefined}
          confirmLabel={consenting === 'update' ? dict.consentUpdate : undefined}
          onConsent={(c) => void consent(c)}
          onCancel={() => setConsenting('none')}
        />
      )}
    </div>
  )
}

interface HeaderProps {
  readonly settings: GuardSettings | null
  readonly isAdmin: boolean
  readonly busy: boolean
  readonly dict: Dict
  readonly onEnable: () => void
  readonly onDisable: () => void
}

function FeatureHeader({ settings, isAdmin, busy, dict, onEnable, onDisable }: HeaderProps) {
  const enabled = settings?.enabled ?? false
  return (
    <div className="setrow">
      <div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{dict.guardFeature}</div>
        <div className="t3" style={{ fontSize: 12, marginTop: 3 }}>
          {dict.guardFeatureNote}
        </div>
      </div>
      <div className="row guard-state-box">
        <span className={enabled ? 'guard-state on' : 'guard-state'} data-testid="guard-state">
          {settings === null ? '…' : enabled ? dict.guardOn : dict.guardOff}
        </span>
        {isAdmin && settings !== null && !enabled && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onEnable}>
            {dict.guardEnable}
          </button>
        )}
        {isAdmin && enabled && (
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={onDisable}>
            {dict.guardDisable}
          </button>
        )}
      </div>
    </div>
  )
}

function DisableConfirm(p: { readonly dict: Dict; readonly busy: boolean; readonly onYes: () => void; readonly onNo: () => void }) {
  return (
    <div className="warnbox guard-disable" data-testid="guard-disable-confirm">
      <span className="grow">{p.dict.guardDisableAsk}</span>
      <button type="button" className="btn btn-sm btn-ghost" onClick={p.onNo}>
        {p.dict.cancel}
      </button>
      <button type="button" className="btn btn-sm btn-danger" disabled={p.busy} onClick={p.onYes}>
        {p.dict.guardDisable}
      </button>
    </div>
  )
}

/** The part before the first colon: the consent's short name. */
const head = (text: string) => text.split(/[:：]/)[0]

function ConsentSummary(p: { readonly consent: GuardConsent; readonly isAdmin: boolean; readonly dict: Dict; readonly onReview: () => void }) {
  const { consent, isAdmin, dict, onReview } = p
  const rows: readonly [string, boolean][] = [
    [dict.consentMonitoring, consent.monitoring],
    [dict.consentExternal, consent.external_data],
    [dict.consentAutoOps, consent.auto_ops],
  ]
  return (
    <div className="guard-consent" data-testid="guard-consent">
      {rows.map(([text, on], i) => (
        <div key={text} className={on ? 'row guard-consent-row on' : 'row guard-consent-row'}>
          {on ? <IconCheck size={14} /> : <IconClose size={14} />}
          <span>
            {i + 1} {head(text)}
          </span>
          <span className="t3">{on ? dict.guardConsentGiven : dict.guardConsentNone}</span>
        </div>
      ))}
      <div className="row guard-consent-foot">
        {consent.by && consent.at_ms !== null && (
          <span className="t3">{dict.guardConsentBy.replace('{by}', consent.by).replace('{at}', dateTimeText(consent.at_ms))}</span>
        )}
        {isAdmin && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onReview}>
            {dict.guardReconsent}
          </button>
        )}
      </div>
    </div>
  )
}

interface BodyProps {
  readonly settings: GuardSettings
  readonly isAdmin: boolean
  readonly busy: boolean
  readonly dict: Dict
  readonly apply: (put: GuardSettingsPut) => Promise<boolean>
}

function EnabledBody({ settings, isAdmin, busy, dict, apply }: BodyProps) {
  return (
    <>
      <section className="inset guard-events">
        <div className="t3 guard-section">{dict.guardEvent}</div>
        <div className="setrow">
          <div style={{ fontSize: 14, fontWeight: 500 }}>{dict.guardToiletBowl}</div>
          <LevelSelect
            label={dict.guardToiletBowl}
            value={settings.toilet_bowl}
            autoOps={settings.consent.auto_ops}
            disabled={!isAdmin || busy}
            dict={dict}
            onChange={(l) => void apply({ toilet_bowl: l })}
          />
        </div>
        <div className="t3 guard-note">{dict.guardLevelNote}</div>
      </section>
      <section className="inset guard-events">
        <GuardTimes countdown={settings.countdown_s} wait={settings.takeover_wait_s} disabled={!isAdmin} dict={dict} onSave={apply} />
      </section>
    </>
  )
}
