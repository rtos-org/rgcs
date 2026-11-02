// The 外的要因 summary chip beside the 2D / 3D switch, with a popover of every factor (plan
// Values always show source + local time; stale readings
// are greyed; SWPC notes and station names are untrusted and rendered as plain text only.
import { useEffect, useRef, useState } from 'react'
import type { EnvFactor, EnvSummary } from '../../shared/api/types'
import { hhmmss } from '../../shared/format/time'
import type { Dict } from '../../shared/i18n'
import { IconCloudSun } from '../../shared/ui/icons'
import { classLabel, factorShort, kindLabel, lastSeen, readingNote, sourceLabel, valueText, worstFactor } from './envFormat'

/** A summary older than this greys the chip itself (the server re-sends on every fusion). */
const SUMMARY_STALE_MS = 30 * 60_000

interface Props {
  readonly summary: EnvSummary | null
  readonly dict: Dict
  readonly now: number
  readonly className?: string
}

function chipState(s: EnvSummary | null, dict: Dict): { cls: string; text: string } {
  if (s === null) return { cls: 'none', text: dict.envChipNone }
  if (s.unavailable) return { cls: 'unavailable', text: `${dict.envChipUnavailable} · ${dict.envChipLast.replace('{time}', hhmmss(lastSeen(s)))}` }
  const worst = worstFactor(s)
  if (worst === null || worst.level === 'ok') return { cls: 'ok', text: dict.envChipOk }
  return { cls: worst.level, text: `${dict.envChip}: ${factorShort(worst, dict)}` }
}

function FactorRow({ f, dict }: { readonly f: EnvFactor; readonly dict: Dict }) {
  const shown = f.value ?? f.primary
  return (
    <li className={`env-factor ${f.level}`} data-testid={`env-factor-${f.kind}`}>
      <div className="row env-factor-h">
        <span className="env-factor-k">{kindLabel(f, dict)}</span>
        <span className={`env-level ${f.level}`}>{dict[`envL_${f.level}`]}</span>
        <div className="grow" />
        {shown && <span className="num env-factor-v">{valueText(f, shown, dict)}</span>}
      </div>
      {f.disagree && <div className="env-disagree">{dict.envChipDisagree}</div>}
      <ul className="env-readings">
        {f.readings.map((r, i) => (
          <li key={`${r.source}-${r.at_ms}-${i}`} className={`env-reading${r.fresh ? '' : ' stale'}`}>
            <span className="env-rsrc">{sourceLabel(r.source, dict)}</span>
            <span className="t3">{classLabel(r, dict)}</span>
            <span className="num">{valueText(f, r, dict)}</span>
            <span className="num t3">{hhmmss(r.at_ms)}</span>
            {!r.fresh && <span className="env-stale-tag">{dict.envChipStale}</span>}
            {readingNote(r) && <span className="env-rnote">{readingNote(r)}</span>}
          </li>
        ))}
      </ul>
    </li>
  )
}

function Popover({ s, dict }: { readonly s: EnvSummary | null; readonly dict: Dict }) {
  return (
    <div className="g-strong env-pop" role="dialog" aria-label={dict.envChipTitle}>
      <div className="row env-pop-h">
        <span className="h2">{dict.envChipTitle}</span>
        <div className="grow" />
        {s && <span className="num t3">{dict.envChipUpdated.replace('{time}', hhmmss(s.ts))}</span>}
      </div>
      {s?.unavailable && <div className="env-pop-warn">{dict.envChipUnavailable}</div>}
      {s && s.missing.length > 0 && <div className="t3 env-pop-line">{dict.envChipMissing.replace('{list}', s.missing.map((id) => sourceLabel(id, dict)).join(', '))}</div>}
      {(!s || s.factors.length === 0) && <div className="t3 env-pop-line">{dict.envChipNoFactors}</div>}
      {s && s.factors.length > 0 && (
        <ul className="env-factors">
          {s.factors.map((f) => (
            <FactorRow key={f.kind} f={f} dict={dict} />
          ))}
        </ul>
      )}
      {s && s.notes.length > 0 && (
        <div className="env-notes">
          <div className="t3">{dict.envChipNotes}</div>
          <ul>
            {s.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="t3 env-pop-foot">{dict.envChipNoTrigger}</div>
    </div>
  )
}

export function EnvSummaryChip({ summary, dict, now, className = 'float map-r2 top1' }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onDown = (e: PointerEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])
  const { cls, text } = chipState(summary, dict)
  const old = summary !== null && now - summary.ts > SUMMARY_STALE_MS
  return (
    <div className={`env-chip-wrap ${className}`} ref={root}>
      <button type="button" className={`g env-chip ${cls}${old ? ' old' : ''}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        <IconCloudSun size={18} />
        <span className="env-chip-t">{text}</span>
      </button>
      {open && <Popover s={summary} dict={dict} />}
    </div>
  )
}
