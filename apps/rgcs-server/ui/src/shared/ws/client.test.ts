import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerMessage } from '../api/types'
import { WsClient, backoffMs, defaultWsUrl, parseFrame } from './client'

class FakeSocket {
  static instances: FakeSocket[] = []
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: MessageEvent<string>) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  readonly url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  receive(text: string) {
    this.onmessage?.({ data: text } as MessageEvent<string>)
  }
  send(text: string) {
    this.sent.push(text)
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
}

describe('ws client helpers', () => {
  it('derives the ws url from the page location', () => {
    expect(defaultWsUrl({ protocol: 'http:', host: 'pi.local:8000' })).toBe('ws://pi.local:8000/ws')
    expect(defaultWsUrl({ protocol: 'https:', host: 'hub.example' })).toBe('wss://hub.example/ws')
  })

  it('backs off exponentially up to 5 s', () => {
    expect([0, 1, 2, 3, 4, 10].map(backoffMs)).toEqual([500, 1000, 2000, 4000, 5000, 5000])
  })

  it('parses only tagged frames', () => {
    expect(parseFrame('{"t":"vehicle_lost","sysid":2}')).toEqual({ t: 'vehicle_lost', sysid: 2 })
    expect(parseFrame('{"x":1}')).toBeNull()
    expect(parseFrame('not json')).toBeNull()
  })
})

describe('WsClient', () => {
  beforeEach(() => {
    FakeSocket.instances = []
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', { OPEN: 1 })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('delivers frames, sends while open and reconnects after close', () => {
    const received: ServerMessage[] = []
    const client = new WsClient('ws://x/ws', { onMessage: (m) => received.push(m) }, (u) => new FakeSocket(u) as unknown as WebSocket)
    client.start()
    expect(client.send({ t: 'input_hb', sysid: 1 })).toBe(false)
    const s1 = FakeSocket.instances[0]
    s1.open()
    expect(client.send({ t: 'input_hb', sysid: 1 })).toBe(true)
    expect(s1.sent[0]).toBe('{"t":"input_hb","sysid":1}')
    s1.receive('{"t":"vehicle_discovered","sysid":1}')
    expect(received).toHaveLength(1)
    s1.close()
    vi.advanceTimersByTime(500)
    expect(FakeSocket.instances).toHaveLength(2)
    client.stop()
    vi.advanceTimersByTime(10_000)
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('stop then start does not let the old socket reconnect, and start is idempotent', () => {
    const closes: number[] = []
    const client = new WsClient('ws://x/ws', { onMessage: () => {}, onClose: () => closes.push(1) }, (u) => new FakeSocket(u) as unknown as WebSocket)
    client.start()
    client.start()
    expect(FakeSocket.instances).toHaveLength(1)
    const s1 = FakeSocket.instances[0]
    s1.open()
    client.stop()
    client.start()
    expect(FakeSocket.instances).toHaveLength(2)
    // the first socket's close arrives late: it must not notify or schedule anything
    s1.onclose?.()
    vi.advanceTimersByTime(10_000)
    expect(FakeSocket.instances).toHaveLength(2)
    expect(closes).toEqual([])
    client.stop()
  })
})
