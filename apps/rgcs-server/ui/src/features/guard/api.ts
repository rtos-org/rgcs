// 実験機能 › AI 緊急介入 settings API. Called only from user actions,
// never from an effect except the initial GET.
import { apiFetch } from '../../shared/api/client'
import type { GuardAlert, GuardLevel, GuardSettings } from '../../shared/api/types'

/** The consent dialog's answer; `monitoring` is always true when enabling. */
export interface ConsentAnswer {
  readonly monitoring: true
  readonly external_data: boolean
  readonly auto_ops: boolean
}

/** `PUT /api/guard/settings`: every field optional; the server validates again. */
export interface GuardSettingsPut {
  readonly enabled?: boolean
  readonly consent?: ConsentAnswer
  readonly toilet_bowl?: GuardLevel
  readonly countdown_s?: number
  readonly takeover_wait_s?: number
}

export const getGuardSettings = () => apiFetch<GuardSettings>('/api/guard/settings')
export const putGuardSettings = (body: GuardSettingsPut) => apiFetch<GuardSettings>('/api/guard/settings', { method: 'PUT', body })

/** Active alerts for a fresh or reconnected client (read-only). */
export const listGuardAlerts = () => apiFetch<GuardAlert[]>('/api/guard/alerts')
/** 取り消し: stops that alert's automatic switch for the rest of the flight (audited). Called only from the button. */
export const cancelGuardAlert = (id: string) => apiFetch<GuardAlert>(`/api/guard/alerts/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
