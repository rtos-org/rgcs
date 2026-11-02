import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WhepPlayer } from './whep'

class FakePC {
  static instances: FakePC[] = []
  localDescription: { type: string; sdp: string } | null = null
  remoteDescription: { type: string; sdp: string } | null = null
  iceGatheringState = 'gathering'
  iceConnectionState = 'new'
  ontrack: ((ev: { streams: unknown[]; track: unknown }) => void) | null = null
  onicegatheringstatechange: (() => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  transceivers: string[] = []
  closed = false
  constructor() {
    FakePC.instances.push(this)
  }
  addTransceiver(kind: string) {
    this.transceivers.push(kind)
  }
  async createOffer() {
    return { type: 'offer', sdp: 'v=0 offer' }
  }
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = d
  }
  async setRemoteDescription(d: { type: string; sdp: string }) {
    this.remoteDescription = d
  }
  getStats() {
    return Promise.resolve(new Map())
  }
  close() {
    this.closed = true
  }
  fireIceComplete() {
    this.iceGatheringState = 'complete'
    this.onicegatheringstatechange?.()
  }
  fireTrack(stream: unknown) {
    this.ontrack?.({ streams: [stream], track: {} })
  }
  fireIceState(state: string) {
    this.iceConnectionState = state
    this.oniceconnectionstatechange?.()
  }
}

const answer = (status = 201) => new Response('v=0 answer', { status, headers: { 'content-type': 'application/sdp' } })

describe('WhepPlayer', () => {
  const fetchMock = vi.fn<typeof fetch>()
  let video: HTMLVideoElement
  beforeEach(() => {
    vi.useFakeTimers()
    FakePC.instances = []
    fetchMock.mockReset()
    video = document.createElement('video')
  })
  afterEach(() => vi.useRealTimers())

  const player = (url = '/api/vehicles/1/video/whep') =>
    new WhepPlayer(video, url, { pc: () => new FakePC() as unknown as RTCPeerConnection, fetchImpl: fetchMock, headers: { 'X-Requested-With': 'rgcs' } })

  it('posts the offer after ice gathering and applies the answer', async () => {
    fetchMock.mockResolvedValue(answer())
    const p = player()
    p.start()
    await vi.advanceTimersByTimeAsync(0)
    const pc = FakePC.instances[0]!
    expect(pc.transceivers).toEqual(['video', 'audio'])
    expect(fetchMock).not.toHaveBeenCalled()
    pc.fireIceComplete()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/vehicles/1/video/whep')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/sdp')
    expect(new Headers(init?.headers).get('X-Requested-With')).toBe('rgcs')
    expect(init?.body).toBe('v=0 offer')
    expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'v=0 answer' })
    expect(p.getState().phase).toBe('connecting')
  })

  it('attaches the stream only on track and keeps it on failure', async () => {
    fetchMock.mockResolvedValue(answer())
    const p = player()
    p.start()
    await vi.advanceTimersByTimeAsync(0)
    const pc = FakePC.instances[0]!
    pc.fireIceComplete()
    await vi.advanceTimersByTimeAsync(0)
    expect(video.srcObject ?? null).toBeNull()
    const stream = { id: 's1' }
    pc.fireTrack(stream)
    expect(video.srcObject).toBe(stream)
    expect(p.getState()).toMatchObject({ phase: 'playing', holdFrame: true })
    pc.fireIceState('failed')
    expect(video.srcObject).toBe(stream)
    expect(pc.closed).toBe(true)
    expect(p.getState()).toMatchObject({ phase: 'reconnecting', attempt: 1, holdFrame: true })
    expect(FakePC.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakePC.instances).toHaveLength(2)
    expect(video.srcObject).toBe(stream)
  })

  it('upstream 503 schedules a retry with backoff', async () => {
    fetchMock.mockResolvedValue(answer(503))
    const p = player()
    p.start()
    await vi.advanceTimersByTimeAsync(0)
    FakePC.instances[0]!.fireIceComplete()
    await vi.advanceTimersByTimeAsync(0)
    expect(p.getState()).toMatchObject({ phase: 'reconnecting', attempt: 1, lastError: 'http_503' })
    await vi.advanceTimersByTimeAsync(999)
    expect(FakePC.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakePC.instances).toHaveLength(2)
    FakePC.instances[1]!.fireIceComplete()
    await vi.advanceTimersByTimeAsync(0)
    expect(p.getState().attempt).toBe(2)
    await vi.advanceTimersByTimeAsync(2000)
    expect(FakePC.instances).toHaveLength(3)
  })

  it('stop closes the connection and cancels the retry', async () => {
    fetchMock.mockResolvedValue(answer(503))
    const p = player()
    p.start()
    await vi.advanceTimersByTimeAsync(0)
    FakePC.instances[0]!.fireIceComplete()
    await vi.advanceTimersByTimeAsync(0)
    p.stop()
    expect(p.getState().phase).toBe('stopped')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(FakePC.instances).toHaveLength(1)
    expect(FakePC.instances[0]!.closed).toBe(true)
  })

  it('gives up waiting for ice after the gather timeout and still posts', async () => {
    fetchMock.mockResolvedValue(answer())
    const p = player()
    p.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
