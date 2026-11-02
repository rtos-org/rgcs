// 外的要因データ API. Keys never reach the UI: only `key_configured` / `key_hint`.
import { apiFetch } from '../../shared/api/client'
import type { EnvSettings, EnvSourceStatus, EnvSummary } from '../../shared/api/types'

export interface EnvSourcePut {
  readonly enabled?: boolean
  readonly interval_s?: number
  readonly timeout_ms?: number
}

export type EnvSettingsPut = Partial<EnvSettings>

export const getEnvSources = () => apiFetch<EnvSourceStatus[]>('/api/env/sources')
export const putEnvSource = (id: string, body: EnvSourcePut) => apiFetch<EnvSourceStatus>(`/api/env/sources/${encodeURIComponent(id)}`, { method: 'PUT', body })
export const fetchNow = (id: string) => apiFetch<EnvSourceStatus>(`/api/env/sources/${encodeURIComponent(id)}/fetch`, { method: 'POST' })
export const getEnvSettings = () => apiFetch<EnvSettings>('/api/env/settings')
export const putEnvSettings = (body: EnvSettingsPut) => apiFetch<EnvSettings>('/api/env/settings', { method: 'PUT', body })
export const getEnvFactors = () => apiFetch<EnvSummary>('/api/env/factors')
