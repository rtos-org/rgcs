import { apiFetch } from '../../shared/api/client'
import type { LogEntry } from '../../shared/api/types'
import { LOG_MAX } from './store'

/** The newest entries of the message log, newest first. */
export function fetchLog(): Promise<LogEntry[]> {
  return apiFetch<LogEntry[]>(`/api/messages?limit=${LOG_MAX}`)
}
