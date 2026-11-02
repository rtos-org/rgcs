// The AI 緊急介入 alert banner: one row per vehicle,
// newest first, centred under the header in the ops stage. 取り消し only calls `onCancel` (the
// cancel API) and only on a click; nothing here sends anything from an effect.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { GuardAlert } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconShieldAlert, IconVolume, IconVolumeOff } from '../../shared/ui/icons'
import { modeChanged, newestFirst, soundingIds, takenOver, type AlertMap } from './alerts'
import { secondsLeft } from './countdown'
import { loadMuted, saveMuted, type Tone } from './sound'

/** The tone repeats this often while an alert is active and not muted. */
export const REPEAT_MS = 10_000

interface Props {
  readonly alerts: AlertMap
  readonly now: number
  readonly dict: Dict
  readonly tone: Tone
  /** The cancel request; a rejected promise re-enables the button. */
  readonly onCancel: (id: string) => void | Promise<unknown>
  readonly onFocus: (sysid: number) => void
}

const fill = (s: string, vars: Readonly<Record<string, string | number>>) => Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), s)

function phaseLine(a: GuardAlert, now: number, dict: Dict): string | null {
  const mode = a.action_mode ?? ''
  switch (a.phase) {
    case 'countdown':
      return fill(dict.gaCountdown, { n: secondsLeft(a.deadline_ms, now) ?? 0, mode })
    case 'due':
      return fill(dict.gaDue, { mode })
    case 'executing':
      return fill(dict.gaExecuting, { mode })
    case 'executed':
      return fill(dict.gaExecuted, { mode })
    case 'cancelled':
      return dict.gaCancelled
    case 'refused':
      return fill(dict.gaRefused, { mode })
    case 'unanswered':
      return dict.gaUnanswered
    case 'taken_over':
      return modeChanged(a) ? fill(dict.gaModeChanged, { mode: a.vehicle_mode }) : null
    default:
      return null
  }
}

/** Repeats the tone while any alert sounds; a newly sounding alert plays at once. */
function useAlertTone(alerts: AlertMap, muted: boolean, tone: Tone): void {
  const key = muted ? '' : soundingIds(alerts).join(',')
  const heard = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const ids = key === '' ? [] : key.split(',')
    const fresh = ids.some((id) => !heard.current.has(id))
    heard.current = new Set(ids)
    if (ids.length === 0) return
    if (fresh) tone.play()
    const timer = setInterval(() => tone.play(), REPEAT_MS)
    return () => clearInterval(timer)
  }, [key, tone])
}

interface RowProps {
  readonly alert: GuardAlert
  readonly now: number
  readonly dict: Dict
  readonly cancelSent: boolean
  readonly onCancel: () => void
  readonly onFocus: () => void
  readonly extra: ReactNode
  readonly controls: ReactNode
}

function GuardRow({ alert: a, now, dict, cancelSent, onCancel, onFocus, extra, controls }: RowProps) {
  const done = takenOver(a)
  const tone = done ? 'neutral' : modeChanged(a) ? 'warn' : 'danger'
  const line = phaseLine(a, now, dict)
  return (
    <div className={`guard-banner ${tone} ${a.phase}`} role="alert" data-testid={`guard-${a.id}`}>
      <IconShieldAlert size={28} className="guard-icon" />
      <div className="guard-body">
        <div className="guard-headline">
          <button type="button" className="guard-name" title={dict.gaFocus} onClick={onFocus}>
            {a.vehicle_name}
          </button>{' '}
          {done ? dict.gaTakenOver : dict.gaHeadline}
        </div>
        {line && <div className={`guard-line${a.phase === 'countdown' ? ' num' : ''}`}>{line}</div>}
        {a.rc_stale && !done && <div className="guard-extra">{dict.gaRcStale}</div>}
        {a.kp_raised && !done && <div className="guard-extra">{dict.gaKpRaised}</div>}
        {extra}
      </div>
      <div className="guard-actions">
        {(a.phase === 'countdown' || a.phase === 'due') && (
          <button type="button" className="btn btn-danger guard-cancel" disabled={cancelSent} onClick={onCancel}>
            {dict.gaCancel}
          </button>
        )}
        {controls}
      </div>
    </div>
  )
}

export function GuardBanner({ alerts, now, dict, tone, onCancel, onFocus }: Props) {
  const [muted, setMuted] = useState(() => loadMuted())
  const [sent, setSent] = useState<ReadonlySet<string>>(() => new Set())
  useAlertTone(alerts, muted, tone)
  const list = newestFirst(alerts)
  if (list.length === 0) return null
  const toggleMute = () => {
    saveMuted(!muted)
    setMuted(!muted)
  }
  const cancel = (id: string) => {
    if (sent.has(id)) return
    setSent((s) => new Set(s).add(id))
    const r = onCancel(id)
    if (r instanceof Promise) r.catch(() => setSent((s) => new Set([...s].filter((x) => x !== id))))
  }
  const sounding = soundingIds(alerts).length > 0
  const locked = sounding && !muted && !tone.ready() ? <div className="guard-extra guard-sound-hint">{dict.gaSoundLocked}</div> : null
  const controls = (
    <button type="button" className={`btn-icon guard-mute${muted ? ' on' : ''}`} aria-label={muted ? dict.gaUnmute : dict.gaMute} title={muted ? dict.gaUnmute : dict.gaMute} aria-pressed={muted} onClick={toggleMute}>
      {muted ? <IconVolumeOff size={20} /> : <IconVolume size={20} />}
    </button>
  )
  return (
    <div className="guard-stack" role="region" aria-label={dict.gaRegion}>
      {list.map((a, i) => (
        <GuardRow
          key={a.id}
          alert={a}
          now={now}
          dict={dict}
          cancelSent={sent.has(a.id)}
          onCancel={() => cancel(a.id)}
          onFocus={() => onFocus(a.sysid)}
          extra={i === 0 ? locked : null}
          controls={i === 0 ? controls : null}
        />
      ))}
    </div>
  )
}
