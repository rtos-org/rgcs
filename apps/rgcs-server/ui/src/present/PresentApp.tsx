import { useEffect, useRef, useState } from 'react'
import { t } from '../shared/i18n'
import { useLang } from '../shared/i18n/lang'
import { WhepPlayer } from '../shared/video/whep'
import type { PlayerPhase } from '../shared/video/state'
import { CSRF_HEADER, CSRF_VALUE } from '../shared/api/client'
import { MiniMap } from './MiniMap'
import { PresentError, presentConfig, presentLogoUrl, presentVehicle, presentWhepUrl, type PresentConfig, type PresentVehicle } from './api'

interface Props {
  readonly token: string
}

type Status = { kind: 'loading' } | { kind: 'invalid' } | { kind: 'ready'; config: PresentConfig }

const VEHICLE_POLL_MS = 500
const BADGE_AFTER_MS = 1000
/** Config retry schedule while the server is unreachable (mirrors the video player's backoff). */
const CONFIG_RETRY_MS = [1000, 2000, 4000, 5000] as const

/** Only a 401 means the link is bad; anything else (server restart, Wi-Fi blip) is retried. */
const isRevoked = (e: unknown): boolean => e instanceof PresentError && e.status === 401

/**
 * The audience page: video, mini-map, logo. Read-only, no session, never a
 * dialog. Video loss keeps the last frame; a small badge appears after 1 s.
 */
export function PresentApp({ token }: Props) {
  const [lang] = useLang()
  const dict = t(lang)
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [vehicle, setVehicle] = useState<PresentVehicle | null>(null)
  const [phase, setPhase] = useState<PlayerPhase>('idle')
  const [badge, setBadge] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const attempt = (n: number) => {
      presentConfig(token)
        .then((config) => alive && setStatus({ kind: 'ready', config }))
        .catch((e: unknown) => {
          if (!alive) return
          if (isRevoked(e)) {
            setStatus({ kind: 'invalid' })
            return
          }
          const delay = CONFIG_RETRY_MS[Math.min(n, CONFIG_RETRY_MS.length - 1)] ?? 5000
          timer = setTimeout(() => attempt(n + 1), delay)
        })
    }
    attempt(0)
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [token])

  const ready = status.kind === 'ready'

  useEffect(() => {
    if (!ready) return
    let alive = true
    const poll = () => {
      presentVehicle(token)
        .then((v) => alive && v && setVehicle(v))
        .catch((e: unknown) => {
          // A revoked link stops everything (player unmounts with the page); other errors keep
          // the last position — the audience never sees a dialog.
          if (alive && isRevoked(e)) setStatus({ kind: 'invalid' })
        })
    }
    const first = setTimeout(poll, 0)
    const id = setInterval(poll, VEHICLE_POLL_MS)
    return () => {
      alive = false
      clearTimeout(first)
      clearInterval(id)
    }
  }, [ready, token])

  useEffect(() => {
    const video = videoRef.current
    if (!ready || !video) return
    const player = new WhepPlayer(video, presentWhepUrl(token), {
      headers: { [CSRF_HEADER]: CSRF_VALUE },
      onState: (s) => {
        setPhase(s.phase)
        if (s.phase !== 'reconnecting') setBadge(false)
      },
    })
    player.start()
    return () => player.stop()
  }, [ready, token])

  useEffect(() => {
    if (phase !== 'reconnecting') return
    const id = setTimeout(() => setBadge(true), BADGE_AFTER_MS)
    return () => clearTimeout(id)
  }, [phase])

  if (status.kind === 'loading') return <div className="present present-blank" />
  if (status.kind === 'invalid') {
    return (
      <div className="present present-blank">
        <div className="present-notice">{dict.presentInvalid}</div>
      </div>
    )
  }
  const { config } = status
  return (
    <div className="present">
      <video ref={videoRef} className="present-video" muted autoPlay playsInline />
      {config.logo && <img className="present-logo" alt="logo" src={presentLogoUrl(token)} />}
      <MiniMap vehicle={vehicle} tileUrl={config.map_tile_url} attribution={config.map_attribution} />
      {badge && <div className="present-badge">{dict.reconnecting}</div>}
    </div>
  )
}
