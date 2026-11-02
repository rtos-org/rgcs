import { useSyncExternalStore } from 'react'
import { WsClient, defaultWsUrl } from '../../shared/ws/client'
import type { ClientMessage, CommandResult, Mission, ServerMessage } from '../../shared/api/types'
import { logReduce, type LogEvent } from '../log/store'
import { addResult, initialState, reduce, setLink, withAck, withVehicleMission, type VehiclesState } from './reducer'

type Listener = () => void
type FrameListener = (msg: ServerMessage) => void

/** Raw WebSocket frames for consumers that keep their own state (the AI panel's guard items). */
export interface FrameSource {
  readonly onFrame: (listener: FrameListener) => () => void
}

/** Single source of truth for vehicle state, fed by the WebSocket. */
export class VehicleStore implements FrameSource {
  private state: VehiclesState = initialState
  private readonly listeners = new Set<Listener>()
  private readonly frameListeners = new Set<FrameListener>()
  private client: WsClient | null = null

  getState = (): VehiclesState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onFrame = (listener: FrameListener): (() => void) => {
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  /** `onClose` receives the WebSocket close code so the shell can re-check the session. */
  connect(url: string = defaultWsUrl(), onClose?: (code: number) => void): void {
    if (this.client) return
    this.client = new WsClient(url, {
      onMessage: (msg) => {
        this.set(reduce(this.state, msg))
        this.frameListeners.forEach((l) => l(msg))
      },
      onOpen: () => this.set(setLink(this.state, 'open')),
      onClose: (code) => {
        this.set(setLink(this.state, 'closed'))
        onClose?.(code)
      },
    })
    this.client.start()
  }

  disconnect(): void {
    this.client?.stop()
    this.client = null
    this.set(setLink(this.state, 'closed'))
  }

  /** Sends a client frame (joystick); false when the socket is not open. */
  send(msg: ClientMessage): boolean {
    return this.client?.send(msg) ?? false
  }

  /** The mission the vehicle is known to carry (after a verified upload or a download). */
  setVehicleMission(sysid: number, mission: Mission): void {
    this.set(withVehicleMission(this.state, sysid, mission))
  }

  /** A result that never went through the server (e.g. 503 on send); negative ids by convention. */
  pushLocalResult(r: CommandResult): void {
    const results = addResult(this.state.results, r)
    if (results === this.state.results) return
    const name = r.mav_cmd === undefined ? r.cmd : `${r.cmd}:${r.mav_cmd}`
    const text = r.reason ? `${name} ${r.reason}` : name
    const severity = r.ok ? 'ok' : 'error'
    const entry = { id: r.id, ts: r.ts, sysid: r.sysid, source: 'command', severity, text, ackable: false, acked_by: null, acked_at: null } as const
    this.set({ ...this.state, results, log: logReduce(this.state.log, { k: 'entry', entry }) })
  }

  /** A warning / error was acknowledged here (the WS `message_ack` confirms it for everyone). */
  markAcked(id: number, by: string, ts: number): void {
    this.set(withAck(this.state, id, by, ts))
  }

  /** History load and the sheet's open / close / filter (UI actions on the log slice). */
  logAction(ev: LogEvent): void {
    const log = logReduce(this.state.log, ev)
    if (log !== this.state.log) this.set({ ...this.state, log })
  }

  private set(next: VehiclesState): void {
    if (next === this.state) return
    this.state = next
    this.listeners.forEach((l) => l())
  }
}

export const vehicleStore = new VehicleStore()

export function useVehicles(store: VehicleStore = vehicleStore): VehiclesState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
