// Thin fetch wrapper for `/api/*`: CSRF header, same-origin cookies, envelope unwrapping
//. A 401 also notifies the auth layer so the UI drops to the login screen.

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ApiInit {
  readonly method?: ApiMethod
  readonly body?: unknown
  /** Give up after this many ms (`ApiError` code `timeout`); no limit by default. */
  readonly timeoutMs?: number
}

export const CSRF_HEADER = 'X-Requested-With'
export const CSRF_VALUE = 'rgcs'

export interface ApiErrorExtra {
  /** `429 rate_limited`: seconds until the next request is accepted (`error.retry_after_s`). */
  readonly retryAfterS?: number
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryAfterS?: number
  constructor(status: number, code: string, message: string, extra: ApiErrorExtra = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAfterS = extra.retryAfterS
  }
}

type Envelope<T> = { success: true; data: T } | { success: false; error: { code: string; message: string; retry_after_s?: unknown } }

let onUnauthorized: (() => void) | null = null

/** Registered once by the app shell; called before a 401 is thrown. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn
}

export async function apiFetch<T>(path: string, init: ApiInit = {}): Promise<T> {
  const hasBody = init.body !== undefined
  const headers: Record<string, string> = { [CSRF_HEADER]: CSRF_VALUE }
  if (hasBody) headers['content-type'] = 'application/json'
  let res: Response
  const abort = init.timeoutMs === undefined ? null : new AbortController()
  const timer = abort ? setTimeout(() => abort.abort(), init.timeoutMs) : null
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers,
      body: hasBody ? JSON.stringify(init.body) : undefined,
      signal: abort?.signal,
    })
  } catch (e) {
    if (abort?.signal.aborted) throw new ApiError(0, 'timeout', `no answer within ${init.timeoutMs} ms`)
    throw new ApiError(0, 'network', e instanceof Error ? e.message : 'network error')
  } finally {
    if (timer) clearTimeout(timer)
  }
  // 204 No Content (e.g. DELETE /api/missions/{id}): success with no envelope
  if (res.status === 204) return undefined as T
  const envelope = await parseEnvelope<T>(res)
  if (envelope.success) return envelope.data
  if (res.status === 401) onUnauthorized?.()
  const retry = envelope.error.retry_after_s
  throw new ApiError(res.status, envelope.error.code, envelope.error.message, typeof retry === 'number' ? { retryAfterS: retry } : {})
}

async function parseEnvelope<T>(res: Response): Promise<Envelope<T>> {
  try {
    const parsed: unknown = await res.json()
    if (typeof parsed === 'object' && parsed !== null && 'success' in parsed) return parsed as Envelope<T>
  } catch {
    // fall through: not a JSON envelope
  }
  return {
    success: false,
    error: { code: res.ok ? 'bad_response' : `http_${res.status}`, message: res.statusText || 'unexpected response' },
  }
}
