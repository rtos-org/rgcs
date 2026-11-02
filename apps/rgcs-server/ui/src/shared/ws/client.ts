import type { ClientMessage, ServerMessage } from '../api/types'

export interface WsHandlers {
  readonly onMessage: (msg: ServerMessage) => void
  readonly onOpen?: () => void
  /** Called with the close code (1005 when the browser gives none). */
  readonly onClose?: (code: number) => void
}

const RECONNECT_MIN_MS = 500
const RECONNECT_MAX_MS = 5000

/** Default URL: same host as the page, `/ws`, ws/wss matching the page scheme. */
export function defaultWsUrl(loc: { protocol: string; host: string } = window.location): string {
  const scheme = loc.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${loc.host}/ws`
}

/** Delay before the n-th reconnect attempt (0-based), capped exponential backoff. */
export function backoffMs(attempt: number): number {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt)
}

export function parseFrame(text: string): ServerMessage | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && 't' in parsed ? (parsed as ServerMessage) : null
  } catch {
    return null
  }
}

/** Minimal reconnecting WebSocket client; `stop()` ends it for good. */
export class WsClient {
  private socket: WebSocket | null = null
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private readonly url: string
  private readonly handlers: WsHandlers
  private readonly factory: (url: string) => WebSocket

  constructor(url: string, handlers: WsHandlers, factory: (url: string) => WebSocket = (u) => new WebSocket(u)) {
    this.url = url
    this.handlers = handlers
    this.factory = factory
  }

  /** Idempotent: a running or scheduled connection is left alone. */
  start(): void {
    if (this.socket || this.timer) return
    this.stopped = false
    this.connect()
  }

  /** Detaches the handlers before closing so the old socket cannot reconnect or report. */
  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
      socket.close()
    }
  }

  send(msg: ClientMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(msg))
    return true
  }

  private connect(): void {
    const socket = this.factory(this.url)
    this.socket = socket
    // Events from a socket that is no longer current (replaced or stopped) are ignored.
    socket.onopen = () => {
      if (this.socket !== socket) return
      this.attempt = 0
      this.handlers.onOpen?.()
    }
    socket.onmessage = (ev: MessageEvent<string>) => {
      if (this.socket !== socket) return
      const frame = parseFrame(ev.data)
      if (frame) this.handlers.onMessage(frame)
    }
    socket.onclose = (ev?: CloseEvent) => {
      if (this.socket !== socket) return
      this.socket = null
      this.handlers.onClose?.(ev?.code ?? 1005)
      this.scheduleReconnect()
    }
    socket.onerror = () => socket.close()
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    const delay = backoffMs(this.attempt)
    this.attempt += 1
    this.timer = setTimeout(() => {
      this.timer = null
      this.connect()
    }, delay)
  }
}
