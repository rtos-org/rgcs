export interface Latency {
  readonly rtt: number | null
  readonly jitter: number | null
}

export interface StatLike {
  readonly type: string
  readonly kind?: string
  readonly jitterBufferDelay?: number
  readonly jitterBufferEmittedCount?: number
  readonly currentRoundTripTime?: number
  readonly nominated?: boolean
}

/** Receiver-side latency figures from `RTCPeerConnection.getStats()`. */
export function latencyMs(report: ReadonlyArray<StatLike>): Latency {
  const video = report.find((s) => s.type === 'inbound-rtp' && s.kind === 'video')
  const pair = report.find((s) => s.type === 'candidate-pair' && s.nominated === true)
  const emitted = video?.jitterBufferEmittedCount ?? 0
  const jitter = video && emitted > 0 && video.jitterBufferDelay !== undefined ? Math.round((video.jitterBufferDelay / emitted) * 1000) : null
  const rtt = pair?.currentRoundTripTime !== undefined ? Math.round(pair.currentRoundTripTime * 1000) : null
  return { rtt, jitter }
}
