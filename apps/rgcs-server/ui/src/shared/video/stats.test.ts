import { describe, expect, it } from 'vitest'
import { latencyMs } from './stats'

describe('latencyMs', () => {
  it('derives jitter buffer delay and nominated-pair rtt in milliseconds', () => {
    const report = [
      { type: 'inbound-rtp', kind: 'video', jitterBufferDelay: 4.0, jitterBufferEmittedCount: 50 },
      { type: 'inbound-rtp', kind: 'audio', jitterBufferDelay: 99, jitterBufferEmittedCount: 1 },
      { type: 'candidate-pair', nominated: false, currentRoundTripTime: 0.9 },
      { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.042 },
    ]
    expect(latencyMs(report)).toEqual({ rtt: 42, jitter: 80 })
  })

  it('returns nulls when the stats are missing', () => {
    expect(latencyMs([])).toEqual({ rtt: null, jitter: null })
    expect(latencyMs([{ type: 'inbound-rtp', kind: 'video', jitterBufferDelay: 1, jitterBufferEmittedCount: 0 }])).toEqual({ rtt: null, jitter: null })
  })
})
