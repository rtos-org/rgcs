// Text helpers for the AI chat panel: ages, tool-run labels, proposal summaries, error copy.
import type { AiProposal } from '../../shared/api/types'
import { cmdLabel, type Dict } from '../../shared/i18n'

/** `1800` → 「1.8 秒前」 under a minute, `65_000` → 「1 分前」 after; `null` (never received) → 「—」. */
export function ageText(ms: number | null, dict: Dict): string {
  if (ms === null) return '—'
  if (ms < 60_000) return dict.aiAgo.replace('{n}', (Math.max(0, ms) / 1000).toFixed(1))
  return dict.aiAgoMin.replace('{n}', String(Math.floor(ms / 60_000)))
}

const TOOL_LABEL: Readonly<Record<string, keyof Dict>> = {
  get_vehicle_status: 'aiToolStatus',
  list_vehicles: 'aiToolVehicles',
  list_recent_messages: 'aiToolMessages',
  search_log: 'aiToolSearch',
  propose_command: 'aiToolPropose',
  list_guard_alerts: 'aiToolGuard',
  get_external_factors: 'aiToolFactors',
}

/** 「状態取得・完了」 / 「ログ検索・失敗」; an unknown tool keeps its raw name. */
export function toolLabel(tool: string, ok: boolean, dict: Dict): string {
  const key = TOOL_LABEL[tool]
  const name = key === undefined ? tool : dict[key]
  return dict.aiToolResult.replace('{tool}', name).replace('{result}', ok ? dict.aiDone : dict.aiFailed)
}

function argText(p: AiProposal): string | null {
  const c = p.command
  switch (c.cmd) {
    case 'set_mode':
      return c.args.mode
    case 'takeoff':
    case 'change_alt':
      return `${c.args.alt_rel} m`
    case 'change_speed':
      return `${c.args.mps} m/s`
    default:
      return null
  }
}

/** The command label plus its argument: 「モード変更 → LOITER」, 「離陸 → 30 m」, 「帰還」. */
export function proposalText(p: AiProposal, dict: Dict): string {
  const label = cmdLabel(p.command.cmd, dict)
  const arg = argText(p)
  return arg === null ? label : `${label} → ${arg}`
}

const ERROR_TEXT: Readonly<Record<string, keyof Dict>> = {
  ai_timeout: 'aiTimeout',
  timeout: 'aiTimeout',
  ai_refused: 'aiRefused',
  ai_provider_error: 'aiProviderError',
  network: 'aiProviderError',
  ai_unconfigured: 'aiUnconfigured',
  ai_busy: 'aiBusy',
  ai_budget: 'aiBudget',
  rate_limited: 'aiRateLimited',
  conversation_full: 'aiFull',
}

/** Panel copy for a `/api/ai/chat` failure; unknown codes show the server message. */
export function aiErrorText(code: string, message: string, dict: Dict, retryAfterS?: number): string {
  if (code === 'rate_limited' && retryAfterS !== undefined) return dict.aiRateLimitedIn.replace('{n}', String(Math.ceil(retryAfterS)))
  const key = ERROR_TEXT[code]
  return key === undefined ? message : dict[key]
}
