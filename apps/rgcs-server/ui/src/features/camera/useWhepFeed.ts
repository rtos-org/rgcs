import { useEffect, useRef, useState } from 'react'
import { CSRF_HEADER, CSRF_VALUE } from '../../shared/api/client'
import type { RecordingState, VideoSourceStatus } from '../../shared/api/types'
import { WhepPlayer } from '../../shared/video/whep'
import type { PlayerState } from '../../shared/video/state'
import type { Latency } from '../../shared/video/stats'
import { whepUrl } from './api'

export const isLive = (status: VideoSourceStatus | undefined): boolean => status !== undefined && status.source !== 'none'

/** Plays the vehicle's WHEP stream into the returned `<video>` ref while a source is live. */
export function useWhepFeed(sysid: number, live: boolean) {
  const ref = useRef<HTMLVideoElement>(null)
  const [phase, setPhase] = useState<PlayerState['phase']>('idle')
  const [latency, setLatency] = useState<Latency | null>(null)
  useEffect(() => {
    const video = ref.current
    if (!live || !video) return
    const player = new WhepPlayer(video, whepUrl(sysid), {
      headers: { [CSRF_HEADER]: CSRF_VALUE },
      onState: (s) => setPhase(s.phase),
      onStats: setLatency,
    })
    player.start()
    return () => player.stop()
  }, [live, sysid])
  return { ref, phase, latency }
}

/** Milliseconds since recording started (0 while idle), ticking once a second. */
export function useRecElapsed(recording: RecordingState): number {
  const [elapsedMs, setElapsedMs] = useState(0)
  useEffect(() => {
    if (recording !== 'recording') return undefined
    // The timer owns the clock: state is only touched from its callbacks, never in the effect body.
    const start = Date.now()
    const tick = () => setElapsedMs(Date.now() - start)
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [recording])
  return elapsedMs
}
