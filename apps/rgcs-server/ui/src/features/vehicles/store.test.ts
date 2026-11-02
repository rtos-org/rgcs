import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VehicleStore } from './store'

class FakeSocket {
  static last: FakeSocket | null = null
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((ev: MessageEvent<string>) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() {
    FakeSocket.last = this
  }
  send() {}
  close() {
    this.readyState = 3
    this.onclose?.()
  }
}

describe('VehicleStore', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('tracks link state and reduces frames, notifying subscribers once per change', () => {
    const store = new VehicleStore()
    const seen: string[] = []
    store.subscribe(() => seen.push(store.getState().link))
    store.connect('ws://x/ws')
    const s = FakeSocket.last!
    s.readyState = 1
    s.onopen?.()
    expect(store.getState().link).toBe('open')
    s.onmessage?.({ data: '{"t":"vehicle_discovered","sysid":4}' } as MessageEvent<string>)
    expect(store.getState().vehicles.get(4)?.name).toBe('UAV-04')
    s.onmessage?.({ data: 'garbage' } as MessageEvent<string>)
    expect(seen).toEqual(['open', 'open'])
    store.disconnect()
    expect(store.getState().link).toBe('closed')
  })

  it('hands every parsed frame to frame listeners until they unsubscribe', () => {
    const store = new VehicleStore()
    const frames: string[] = []
    const off = store.onFrame((m) => frames.push(m.t))
    store.connect('ws://x/ws')
    const s = FakeSocket.last!
    s.onmessage?.({ data: '{"t":"vehicle_discovered","sysid":4}' } as MessageEvent<string>)
    s.onmessage?.({ data: 'garbage' } as MessageEvent<string>)
    off()
    s.onmessage?.({ data: '{"t":"vehicle_discovered","sysid":5}' } as MessageEvent<string>)
    expect(frames).toEqual(['vehicle_discovered'])
    store.disconnect()
  })

  it('connect is idempotent', () => {
    const store = new VehicleStore()
    store.connect('ws://x/ws')
    const first = FakeSocket.last
    store.connect('ws://x/ws')
    expect(FakeSocket.last).toBe(first)
    store.disconnect()
  })
})

describe('local results', () => {
  it('pushLocalResult adds a synthetic result once', async () => {
    const { VehicleStore } = await import('./store')
    const s = new VehicleStore()
    const r = { id: -1, sysid: 1, cmd: 'pause', ok: false, reason: 'link_lost', ts: 1 }
    s.pushLocalResult(r)
    s.pushLocalResult(r)
    expect(s.getState().results).toEqual([r])
  })

  it('pushLocalResult logs an other command with its MAV_CMD', async () => {
    const { VehicleStore } = await import('./store')
    const s = new VehicleStore()
    s.pushLocalResult({ id: -2, sysid: 1, cmd: 'other', ok: false, reason: 'link_lost', ts: 1, mav_cmd: 224 })
    expect(s.getState().log.entries[0]?.text).toBe('other:224 link_lost')
  })
})

describe('send', () => {
  it('returns false when not connected', async () => {
    const { VehicleStore } = await import('./store')
    expect(new VehicleStore().send({ t: 'input_hb', sysid: 1 })).toBe(false)
  })
})
