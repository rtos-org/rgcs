import { Fragment, useState, type ReactElement, type ReactNode } from 'react'
import type { VehicleCommand, VehicleState } from '../../shared/api/types'
import { cmdLabel, type Dict } from '../../shared/i18n'
import {
  IconAltitude,
  IconCamera,
  IconCheck,
  IconClose,
  IconCrosshair,
  IconEllipsis,
  IconHouse,
  IconLand,
  IconTakeoff,
  IconPause,
  IconPlay,
  IconPower,
  IconPowerOff,
  IconRepeat,
  IconSearch,
  IconSpeed,
  IconStepForward,
} from '../../shared/ui/icons'
import { CATALOG, TAKEOFF_ALT_DEFAULT, catalogGroups, flies, modesFor, takeoffKind, type CatalogItem, type CommandGroup, type ModalTarget } from './catalog'
import type { BtnState } from './feedback'

interface Props {
  readonly vehicle: VehicleState
  readonly onPick: (command: VehicleCommand) => void
  readonly onOpen: (target: ModalTarget) => void
  readonly onClose: () => void
  readonly dict: Dict
  /** Rendered beside the detail panel (prototype `map-r top2`) when it is open. */
  readonly beside?: boolean
  /** Shown under the commands (the dock's sending / last-result line). */
  readonly footer?: ReactNode
  /** Per-button sending / done / failed for the shown vehicle. */
  readonly feedback?: (cmd: string) => BtnState | null
  /** The vehicle's recent PreArm refusals, shown under ARM while disarmed. */
  readonly prearm?: readonly string[]
}

const FB_ICON: Record<BtnState, () => ReactElement | null> = { sending: () => null, ok: () => <IconCheck size={12} />, fail: () => <IconClose size={12} /> }

const GROUP_LABEL: Record<CommandGroup, keyof Dict> = { flight: 'groupFlight', move: 'groupMove', mode: 'groupMode', payload: 'groupPayload' }
/** Lucide icon per command name. */
const ICON: Record<string, () => ReactElement> = {
  takeoff: () => <IconTakeoff />,
  pause: () => <IconPause />,
  resume: () => <IconPlay />,
  rtl: () => <IconHouse size={18} />,
  land: () => <IconLand />,
  guided: () => <IconCrosshair />,
  change_alt: () => <IconAltitude />,
  change_speed: () => <IconSpeed size={18} />,
  set_mode: () => <IconRepeat />,
  mission_start: () => <IconPlay />,
  mission_resume: () => <IconStepForward />,
  arm: () => <IconPower />,
  disarm: () => <IconPowerOff />,
  camera: () => <IconCamera />,
  other: () => <IconEllipsis />,
}

function label(item: CatalogItem, dict: Dict): string {
  return item.name === 'camera' ? dict.cmd_camera : cmdLabel(item.name, dict)
}

/** One-click mode chips (operator proposal 5); still confirm-gated like 「モード変更」. */
function QuickModes({ modes, current, dict, onPick }: { modes: readonly string[]; current: string; dict: Dict; onPick: (c: VehicleCommand) => void }) {
  return (
    <div className="quick-modes" role="group" aria-label={dict.quickModes}>
      {modes.map((m) => (
        <button key={m} type="button" className={`chip${m === current ? ' on' : ''}`} aria-pressed={m === current} onClick={() => onPick({ cmd: 'set_mode', args: { mode: m } })}>
          {m}
        </button>
      ))}
    </div>
  )
}

/** A numeric input with -5 / +5 steps. */
function StepInput({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  const step = (d: number) => onChange(String((Number(value) || 0) + d))
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm step" onClick={() => step(-5)}>
        -5
      </button>
      <input className="rg-num" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="btn btn-ghost btn-sm step" onClick={() => step(5)}>
        +5
      </button>
    </>
  )
}

/** Right-aligned 380 px sheet listing every command by group in a 2-column grid. */
export function CommandsSheet({ vehicle, onPick, onOpen, onClose, dict, beside = false, footer, feedback, prearm = [] }: Props) {
  const [query, setQuery] = useState('')
  const modes = modesFor(vehicle)
  const [mode, setMode] = useState(vehicle.mode || modes.all[0]!)
  const [alt, setAlt] = useState('')
  const [speed, setSpeed] = useState('')
  const [takeoffAlt, setTakeoffAlt] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const q = query.trim().toLowerCase()
  const shown = CATALOG.filter((i) => (i.available?.(vehicle) ?? true) && (q === '' || label(i, dict).toLowerCase().includes(q) || i.name.includes(q)))

  // why a button is disabled, shown under it
  const why = (item: CatalogItem): string | null => (!item.enabled(vehicle) && item.disabledHint ? dict[item.disabledHint] : null)
  const pick = (item: CatalogItem) => {
    if (item.opens) return onOpen(item.opens)
    if (item.param && open !== item.name) {
      // start from where the vehicle is now
      if (item.param === 'alt') setAlt(String(Math.round(vehicle.alt_rel)))
      if (item.param === 'speed') setSpeed(String(Math.round(vehicle.ground_speed)))
      if (item.param === 'takeoff') setTakeoffAlt(String(TAKEOFF_ALT_DEFAULT))
      return setOpen(item.name)
    }
    const raw = { alt, speed, takeoff: takeoffAlt, mode: '' }[item.param ?? 'mode']
    const value = raw === '' ? undefined : Number(raw)
    const command = item.build?.({ mode, value }) ?? null
    if (command) {
      setOpen(null)
      onPick(command)
    }
  }

  const paramRow = (item: CatalogItem) => (
    <div className="cmd-param" key={`${item.name}-param`}>
      {item.param === 'mode' && (
        <select className="rg-sel" aria-label={label(item, dict)} value={mode} onChange={(e) => setMode(e.target.value)}>
          {modes.all.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      )}
      {item.param === 'alt' && <StepInput label={label(item, dict)} placeholder={dict.altInput} value={alt} onChange={setAlt} />}
      {item.param === 'speed' && <StepInput label={label(item, dict)} placeholder={dict.speedInput} value={speed} onChange={setSpeed} />}
      {item.param === 'takeoff' &&
        (takeoffKind(vehicle) === 'climb' ? (
          <StepInput label={label(item, dict)} placeholder={dict.altInput} value={takeoffAlt} onChange={setTakeoffAlt} />
        ) : (
          <span className="t2 grow">{dict.takeoffToTkoffAlt}</span>
        ))}
      <button type="button" className="btn btn-primary btn-sm" onClick={() => pick(item)}>
        {dict.run}
      </button>
    </div>
  )

  return (
    <aside className={`g-strong panel sheet${beside ? ' beside' : ''}`} aria-label={dict.allCommands}>
      <div className="panel-h">
        {/* keyed: a new target remounts the name and replays the flash (operator proposal 3) */}
        <span key={vehicle.sysid} className="h1 target-flash">
          {vehicle.name}
        </span>
        <span className="h1 t2" style={{ fontWeight: 300 }}>
          {dict.allCommands}
        </span>
        <div className="grow" />
        <button type="button" className="btn-icon" aria-label={dict.close} title={dict.close} onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="sheet-search">
        <div className="in">
          <IconSearch />
          <input className="in bare grow" placeholder={dict.searchCommands} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <div className="sheet-body">
        {q === '' && <QuickModes modes={modes.quick} current={vehicle.mode} dict={dict} onPick={onPick} />}
        {catalogGroups(shown).map(({ group, items }) => (
          <div key={group}>
            <div className="cmd-group-title">{dict[group === 'flight' && !flies(vehicle) ? 'groupDrive' : GROUP_LABEL[group]]}</div>
            <div className="cmd-grid">
              {items.map((item) => {
                const fb = item.build ? (feedback?.(item.name) ?? null) : null
                return (
                  <Fragment key={item.name}>
                    <button
                      type="button"
                      className={`cmd-btn${item.name === 'guided' ? ' full' : ''}${open === item.name ? ' on' : ''}${fb ? ` ${fb}` : ''}`}
                      disabled={!item.enabled(vehicle)}
                      aria-describedby={why(item) ? `why-${item.name}` : undefined}
                      onClick={() => pick(item)}
                    >
                      <span className="glyph" aria-hidden="true">
                        {(ICON[item.name] ?? ICON.other)()}
                      </span>
                      <span className="ell">{label(item, dict)}</span>
                      {fb && <span className="cmd-fb" aria-hidden="true">{FB_ICON[fb]()}</span>}
                    </button>
                    {why(item) && (
                      <div className="cmd-why t3" id={`why-${item.name}`}>
                        {why(item)}
                      </div>
                    )}
                    {open === item.name && item.param && paramRow(item)}
                    {item.name === 'arm' && !vehicle.armed && prearm.length > 0 && (
                      <ul className="cmd-prearm" data-testid="prearm">
                        {prearm.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    )}
                  </Fragment>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {footer}
    </aside>
  )
}
