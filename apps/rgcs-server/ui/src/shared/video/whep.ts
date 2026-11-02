// WHEP (WebRTC-HTTP egress) player: one POST with a fully gathered offer, the answer applied,
// the stream attached only when a track arrives, and the last frame kept across reconnects.

import { INITIAL_PLAYER, backoffMs, connected, failed, start, stopped, type PlayerState } from './state'
import { latencyMs, type Latency, type StatLike } from './stats'

export interface PlayerOptions {
  readonly pc?: () => RTCPeerConnection
  readonly fetchImpl?: typeof fetch
  readonly headers?: Record<string, string>
  readonly onState?: (s: PlayerState) => void
  readonly onStats?: (l: Latency) => void
  readonly iceGatherTimeoutMs?: number
  readonly statsIntervalMs?: number
}

const DEFAULT_ICE_TIMEOUT_MS = 2000
const DEFAULT_STATS_INTERVAL_MS = 1000

export class WhepPlayer {
  private state: PlayerState = INITIAL_PLAYER
  private pc: RTCPeerConnection | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private readonly video: HTMLVideoElement
  private readonly url: string
  private readonly opts: PlayerOptions

  constructor(video: HTMLVideoElement, url: string, opts: PlayerOptions = {}) {
    this.video = video
    this.url = url
    this.opts = opts
  }

  getState(): PlayerState {
    return this.state
  }

  start(): void {
    if (this.state.phase !== 'idle' && this.state.phase !== 'stopped') return
    this.set(start(this.state))
    void this.connect()
  }

  /** Ends the session for good; the `<video>` keeps whatever it last showed. */
  stop(): void {
    this.set(stopped(this.state))
    this.clearTimers()
    this.closePc()
  }

  private set(next: PlayerState): void {
    this.state = next
    this.opts.onState?.(next)
  }

  private clearTimers(): void {
    if (this.retry) clearTimeout(this.retry)
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.retry = null
    this.statsTimer = null
  }

  private closePc(): void {
    const pc = this.pc
    this.pc = null
    if (!pc) return
    pc.ontrack = null
    pc.oniceconnectionstatechange = null
    pc.onicegatheringstatechange = null
    pc.close()
  }

  private async connect(): Promise<void> {
    const factory = this.opts.pc ?? (() => new RTCPeerConnection())
    const pc = factory()
    this.pc = pc
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })
    pc.ontrack = (ev) => {
      if (this.pc !== pc) return
      this.video.srcObject = ev.streams[0] ?? new MediaStream([ev.track])
      this.set(connected(this.state))
      this.startStats(pc)
    }
    pc.oniceconnectionstatechange = () => {
      if (this.pc !== pc) return
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') this.fail(`ice_${pc.iceConnectionState}`)
    }
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await this.waitForIce(pc)
      if (this.pc !== pc) return
      const fetchImpl = this.opts.fetchImpl ?? fetch
      const res = await fetchImpl(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/sdp', ...this.opts.headers },
        body: pc.localDescription?.sdp ?? offer.sdp ?? '',
      })
      if (this.pc !== pc) return
      if (!res.ok) return this.fail(`http_${res.status}`)
      const sdp = await res.text()
      if (this.pc !== pc) return
      await pc.setRemoteDescription({ type: 'answer', sdp })
    } catch (e) {
      if (this.pc === pc) this.fail(e instanceof Error ? e.message : String(e))
    }
  }

  /** Resolves when ICE gathering completes or after the timeout (then we post what we have). */
  private waitForIce(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(done, this.opts.iceGatherTimeoutMs ?? DEFAULT_ICE_TIMEOUT_MS)
      function done() {
        clearTimeout(timer)
        pc.onicegatheringstatechange = null
        resolve()
      }
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') done()
      }
    })
  }

  private fail(error: string): void {
    if (this.state.phase === 'stopped') return
    this.clearTimers()
    this.closePc()
    this.set(failed(this.state, error))
    this.retry = setTimeout(() => {
      this.retry = null
      if (this.state.phase !== 'reconnecting') return
      void this.connect()
    }, backoffMs(this.state.attempt - 1))
  }

  private startStats(pc: RTCPeerConnection): void {
    if (!this.opts.onStats) return
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = setInterval(() => {
      void pc.getStats().then((report) => {
        if (this.pc !== pc) return
        const stats: StatLike[] = []
        report.forEach((s: StatLike) => stats.push(s))
        this.opts.onStats?.(latencyMs(stats))
      })
    }, this.opts.statsIntervalMs ?? DEFAULT_STATS_INTERVAL_MS)
  }
}
