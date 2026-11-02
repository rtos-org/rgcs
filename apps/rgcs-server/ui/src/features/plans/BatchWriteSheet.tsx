// 割当どおり書き込む confirmation (spec 2026-10-20 §5.5, 2026-10-31 §7): plan → vehicle, what fence /
// rally each vehicle still holds (消す / 残す, default 残す), then per-row progress while the batch
// runs. An armed vehicle's row is red and left out until its box is ticked.
import { useState, type ReactNode } from 'react'
import type { Mission } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconCheck, IconClose, IconError } from '../../shared/ui/icons'
import { km, mmss } from '../mission/labels'
import { BATCH_REASONS, type BatchJob, type BatchState, type Leftover } from './batch'
import type { BatchSheet } from './batchStore'

export interface SheetLine {
  readonly key: string
  readonly color: string
  readonly name: string
  readonly sysid: number
  readonly vehicle: string
  readonly distanceM: number
  readonly mission: Mission
  /** The saved plan's id: written through the saved upload. */
  readonly savedId?: number
  readonly durationS?: number
  /** The plan changed since the vehicle's last write (更新あり). */
  readonly updated?: boolean
  /** The flight mode of an armed vehicle; absent when disarmed. */
  readonly armed?: string | null
}

interface Props {
  readonly lines: readonly SheetLine[]
  /** null while the vehicles are being read. */
  readonly leftovers: ReadonlyMap<number, Leftover> | null
  readonly states: ReadonlyMap<string, BatchState>
  readonly running: boolean
  readonly dict: Dict
  readonly onWrite: (jobs: readonly BatchJob[]) => void
  readonly onClose: () => void
}

type Clear = { readonly fence: boolean; readonly rally: boolean }
const KEEP: Clear = { fence: false, rally: false }

function reasonText(reason: string | null, dict: Dict): string {
  const known: Record<string, string> = {
    [BATCH_REASONS.offline]: dict.plOffline,
    [BATCH_REASONS.mismatch]: dict.plMismatch,
    [BATCH_REASONS.fenceMismatch]: dict.plFenceMismatch,
    [BATCH_REASONS.rallyMismatch]: dict.plRallyMismatch,
    [BATCH_REASONS.fatal]: dict.upFatal,
  }
  return reason === null ? '' : (known[reason] ?? reason)
}

/** 消す only counts where the line shows the control: a known leftover > 0 and none in the mission. */
const erasable = (own: number, left: number | null | undefined): boolean => own === 0 && typeof left === 'number' && left > 0

const isArmed = (l: SheetLine): boolean => l.armed !== undefined && l.armed !== null

/** Armed vehicles only when their box is ticked (`replace`). */
const included = (l: SheetLine, replace: ReadonlySet<string>): boolean => !isArmed(l) || replace.has(l.key)

function toJobs(lines: readonly SheetLine[], leftovers: ReadonlyMap<number, Leftover> | null, clear: ReadonlyMap<string, Clear>, replace: ReadonlySet<string>): BatchJob[] {
  return lines
    .filter((l) => included(l, replace))
    .map((l) => {
      const left = leftovers?.get(l.sysid)
      const c = clear.get(l.key) ?? KEEP
      return {
        key: l.key,
        sysid: l.sysid,
        mission: l.mission,
        ...(l.savedId === undefined ? {} : { savedId: l.savedId }),
        clearFence: c.fence && erasable(l.mission.fence.length, left?.fence),
        clearRally: c.rally && erasable(l.mission.rally.length, left?.rally),
      }
    })
}

/** Waiting / writing as text; done and failed with a Lucide mark (no text glyphs). */
function phaseText(s: BatchState, dict: Dict): ReactNode {
  if (s.phase === 'waiting') return dict.plWaiting
  if (s.phase === 'writing') return dict.plWriting
  const done = s.phase === 'done'
  return (
    <span className="row" style={{ gap: 4 }}>
      {done ? <IconCheck size={14} /> : <IconError size={14} />}
      {done ? dict.plDone : reasonText(s.reason, dict)}
    </span>
  )
}

/** A row's phase: its batch state, else 待機 (to be written) or 対象外 (left out). */
function Phase({ state, skipped, dict }: { readonly state: BatchState | undefined; readonly skipped: boolean; readonly dict: Dict }) {
  if (state) return <div className={`plans-phase ${state.phase}`}>{phaseText(state, dict)}</div>
  return <div className={skipped ? 'plans-phase skipped' : 'plans-phase'}>{skipped ? dict.plSkipped : dict.plWaiting}</div>
}

interface ChoiceProps {
  readonly text: string
  readonly erase: boolean
  readonly disabled: boolean
  readonly dict: Dict
  readonly onChange: (erase: boolean) => void
}

/** 前のフェンス N 区画が残っています + 消す / 残す. */
function Choice({ text, erase, disabled, dict, onChange }: ChoiceProps) {
  return (
    <div className="row plans-left">
      <span className="hint caution grow">{text}</span>
      <div className="seg sm" role="group" aria-label={text}>
        <span className="lens" style={{ transform: `translateX(${erase ? 0 : 100}%)` }} />
        <button type="button" className={erase ? 'on' : ''} disabled={disabled} onClick={() => onChange(true)}>
          {dict.plErase}
        </button>
        <button type="button" className={erase ? '' : 'on'} disabled={disabled} onClick={() => onChange(false)}>
          {dict.plKeep}
        </button>
      </div>
    </div>
  )
}

interface LeftProps {
  readonly own: number
  readonly left: number | null | undefined
  readonly texts: readonly [string, string]
  readonly erase: boolean
  readonly disabled: boolean
  readonly dict: Dict
  readonly onChange: (erase: boolean) => void
}

/** Nothing when the mission brings its own (or nothing is left); 不明 when the read failed. */
function LeftoverLine({ own, left, texts, ...rest }: LeftProps) {
  if (own > 0 || left === undefined || left === 0) return null
  if (left === null) return <div className="t3 plans-left">{texts[1]}</div>
  return <Choice text={texts[0].replace('{n}', String(left))} {...rest} />
}

interface RowProps {
  readonly line: SheetLine
  readonly left: Leftover | undefined
  readonly clear: Clear
  readonly replace: boolean
  readonly state: BatchState | undefined
  readonly started: boolean
  readonly dict: Dict
  readonly onClear: (patch: Partial<Clear>) => void
  readonly onReplace: (on: boolean) => void
}

function SheetRow({ line: l, left, clear: c, replace, state, started, dict, onClear, onReplace }: RowProps) {
  const armed = isArmed(l)
  return (
    <li className={armed ? 'plans-sheet-row armed' : 'plans-sheet-row'}>
      <div className="row" style={{ gap: 8 }}>
        <span className="plans-dot" style={{ background: l.color }} aria-hidden="true" />
        <span className="plans-sheet-name">{`${l.name} → ${l.vehicle}`}</span>
        <span className="grow" />
        <span className="num t2">{l.durationS === undefined ? km(l.distanceM) : `${km(l.distanceM)} · ${mmss(l.durationS)}`}</span>
      </div>
      {l.updated && <div className="plans-sheet-sub plans-updated">{dict.plUpdated}</div>}
      <LeftoverLine own={l.mission.fence.length} left={left?.fence} texts={[dict.plLeftFence, dict.plLeftFenceUnknown]} erase={c.fence} disabled={started} dict={dict} onChange={(fence) => onClear({ fence })} />
      <LeftoverLine own={l.mission.rally.length} left={left?.rally} texts={[dict.plLeftRally, dict.plLeftRallyUnknown]} erase={c.rally} disabled={started} dict={dict} onChange={(rally) => onClear({ rally })} />
      {armed && (
        <label className="plans-arm">
          <input type="checkbox" checked={replace} disabled={started} onChange={(e) => onReplace(e.target.checked)} />
          {dict.plReplaceArmed.replace('{name}', l.vehicle).replace('{mode}', l.armed ?? '')}
        </label>
      )}
      <Phase state={state} skipped={armed && !replace} dict={dict} />
    </li>
  )
}

export function BatchWriteSheet({ lines, leftovers, states, running, dict, onWrite, onClose }: Props) {
  const [clear, setClear] = useState<ReadonlyMap<string, Clear>>(new Map())
  const [replace, setReplace] = useState<ReadonlySet<string>>(new Set())
  const started = running || states.size > 0
  const count = lines.filter((l) => included(l, replace)).length
  const choose = (key: string, patch: Partial<Clear>) => setClear((m) => new Map([...m, [key, { ...(m.get(key) ?? KEEP), ...patch }]]))
  const tick = (key: string, on: boolean) => setReplace((s) => new Set(on ? [...s, key] : [...s].filter((k) => k !== key)))
  return (
    <aside className="g-strong sheet up-sheet plans-sheet" aria-label={dict.plWriteAll} role="dialog">
      <div className="panel-h">
        <span className="h1">{dict.plWriteAll}</span>
        <span className="grow" />
        <button type="button" className="btn-icon" aria-label={dict.close} disabled={running} onClick={onClose}>
          <IconClose />
        </button>
      </div>
      {leftovers === null && <div className="t3 plans-reading">{dict.plReading}</div>}
      <ul className="plans-sheet-list">
        {lines.map((l) => (
          <SheetRow key={l.key} line={l} left={leftovers?.get(l.sysid)} clear={clear.get(l.key) ?? KEEP} replace={replace.has(l.key)} state={states.get(l.key)} started={started} dict={dict}
            onClear={(patch) => choose(l.key, patch)} onReplace={(on) => tick(l.key, on)} />
        ))}
      </ul>
      {lines.some(isArmed) && <p className="plans-note caution">{dict.plAutoNote}</p>}
      <p className="plans-note">{dict.plWriteSteps}</p>
      <div className="up-foot" style={{ gap: 8 }}>
        <button type="button" className={started && !running ? 'btn btn-primary' : 'btn'} disabled={running} onClick={onClose}>
          {started ? dict.plClose : dict.plCancel}
        </button>
        {!started && (
          <button type="button" className="btn btn-primary" disabled={leftovers === null || count === 0} onClick={() => onWrite(toJobs(lines, leftovers, clear, replace))}>
            {dict.plWriteN.replace('{n}', String(count))}
          </button>
        )}
      </div>
    </aside>
  )
}

/** One sheet per session: a re-open starts with every choice back at 残す. */
export function BatchSheetView({ sheet, ...rest }: { readonly sheet: BatchSheet } & Pick<Props, 'dict' | 'onWrite' | 'onClose'>) {
  const { session, ...props } = sheet
  return <BatchWriteSheet key={session} {...props} {...rest} />
}
