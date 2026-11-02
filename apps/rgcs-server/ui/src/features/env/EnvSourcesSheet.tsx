// 外的要因データ sheet: sources with status and 今すぐ取得, the consent state (§3 #2),
// location rounding, the threshold tables and the offline behaviour. Admin edits; operators read.
import { useEffect, useState } from 'react'
import { ApiError } from '../../shared/api/client'
import type { EnvSettings, EnvSourceStatus, GuardSettings } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconCloudSun, IconExternalLink, IconInfo } from '../../shared/ui/icons'
import { getGuardSettings } from '../guard/api'
import { getEnvSettings, getEnvSources, putEnvSettings, type EnvSettingsPut } from './api'
import { errorText, EnvSourceRow } from './EnvSourceRow'
import { ThresholdTable } from './ThresholdTable'

interface Props {
  readonly isAdmin: boolean
  readonly dict: Dict
  readonly onClose: () => void
}

const ROUNDING = ['0.01', '0.05', '0.1'] as const
const NICT_URL = 'https://swc.nict.go.jp/'

const message = (e: unknown, dict: Dict) => (e instanceof ApiError ? errorText(e.code, dict) || e.message : String(e))

export function EnvSourcesSheet({ isAdmin, dict, onClose }: Props) {
  const [sources, setSources] = useState<readonly EnvSourceStatus[]>([])
  const [settings, setSettings] = useState<EnvSettings | null>(null)
  const [guard, setGuard] = useState<GuardSettings | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getEnvSources()
      .then(setSources)
      .catch((e: unknown) => setError(message(e, dict)))
    getEnvSettings()
      .then(setSettings)
      .catch((e: unknown) => setError(message(e, dict)))
    getGuardSettings()
      .then(setGuard)
      .catch(() => setGuard(null))
  }, [dict])

  const replace = (next: EnvSourceStatus) => setSources((cur) => cur.map((s) => (s.id === next.id ? next : s)))
  const saveSettings = async (put: EnvSettingsPut): Promise<boolean> => {
    setError(null)
    try {
      setSettings(await putEnvSettings(put))
      return true
    } catch (e: unknown) {
      setError(message(e, dict))
      return false
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="g-strong confirm env-sources" role="dialog" aria-label={dict.envTitle}>
        <div className="row guard-head">
          <IconCloudSun size={18} />
          <div className="h2">{dict.envTitle}</div>
        </div>
        <ConsentState guard={guard} dict={dict} />
        <RoundingRow settings={settings} isAdmin={isAdmin} dict={dict} onPick={(v) => void saveSettings({ rounding_deg: v })} />
        <div className="t3 guard-section">{dict.envSources}</div>
        <div className="env-src-list">
          {sources.map((s) => (
            <EnvSourceRow key={s.id} status={s} isAdmin={isAdmin} dict={dict} onChange={replace} />
          ))}
          {sources.length > 0 && <NictRow dict={dict} />}
        </div>
        {settings && <ThresholdTable settings={settings} isAdmin={isAdmin} dict={dict} onSave={saveSettings} />}
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
    </div>
  )
}

function ConsentState({ guard, dict }: { readonly guard: GuardSettings | null; readonly dict: Dict }) {
  const consent = guard?.consent.external_data ?? false
  return (
    <section className="inset env-consent">
      <div className={consent ? 'env-consent-line on' : 'env-consent-line'}>{consent ? dict.envConsentOn : dict.envConsentOff}</div>
      {guard !== null && !guard.enabled && <div className="t3">{dict.envGuardOff}</div>}
      <div className="row env-offline">
        <IconInfo size={14} />
        <span>{dict.envOffline}</span>
      </div>
      <div className="t3">{dict.envNoTrigger}</div>
    </section>
  )
}

interface RoundingProps {
  readonly settings: EnvSettings | null
  readonly isAdmin: boolean
  readonly dict: Dict
  readonly onPick: (v: number) => void
}

function RoundingRow({ settings, isAdmin, dict, onPick }: RoundingProps) {
  const value = settings ? (ROUNDING.find((r) => Number(r) === settings.rounding_deg) ?? '0.01') : '0.01'
  return (
    <div className="setrow env-rounding">
      <div>
        <label htmlFor="env-rounding" style={{ fontSize: 14, fontWeight: 500 }}>
          {dict.envRounding}
        </label>
        <div className="t3" style={{ fontSize: 12, marginTop: 3 }}>
          {dict.envRoundingNote}
        </div>
      </div>
      <select id="env-rounding" className="in" value={value} disabled={!isAdmin || settings === null} onChange={(e) => onPick(Number(e.target.value))}>
        {ROUNDING.map((r) => (
          <option key={r} value={r}>
            {r}°
          </option>
        ))}
      </select>
    </div>
  )
}

function NictRow({ dict }: { readonly dict: Dict }) {
  return (
    <div className="inset env-src off unsupported" data-testid="env-src-nict">
      <div className="env-src-main">
        <span className="env-src-title" data-testid="env-src-title">
          {dict.envSrcNict}
        </span>
        <div className="t3 env-src-terms">{dict.envTerms_nict}</div>
      </div>
      <a className="btn btn-sm btn-ghost env-link" href={NICT_URL} target="_blank" rel="noreferrer noopener">
        <IconExternalLink />
        {dict.envNictLink}
      </a>
    </div>
  )
}
