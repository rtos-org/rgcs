import type { VehicleCommand, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'

/** Mirror of `rgcs-core::VehicleCommand::requires_confirm`; pinned by catalog.test. */
export const REQUIRES_CONFIRM: ReadonlySet<string> = new Set(['arm', 'disarm', 'mission_start', 'takeoff'])

/** Commands whose confirm button is rendered as danger. */
export const DESTRUCTIVE: ReadonlySet<string> = new Set(['arm', 'disarm', 'rtl', 'land'])

/** Per airframe: `quick` are the one-click chips above the command groups (operator proposal 5,
 * the modes used most); `all` is the 「モード変更」 list. Names match rgcs-mavlink's mode tables. */
export interface FrameModes {
  readonly quick: readonly string[]
  readonly all: readonly string[]
}

// Rust mirror: modes_for() in crates/rgcs-mavlink/src/modes.rs; keep both lists in sync.
const PLANE_ALL = ['MANUAL', 'STABILIZE', 'ACRO', 'TRAINING', 'FBWA', 'FBWB', 'CRUISE', 'AUTOTUNE', 'TAKEOFF', 'LOITER', 'CIRCLE', 'GUIDED', 'AUTO', 'RTL', 'THERMAL']

const MODES: Readonly<Record<'copter' | 'plane' | 'quadplane' | 'rover', FrameModes>> = {
  copter: {
    quick: ['STABILIZE', 'ALT_HOLD', 'LOITER', 'POSHOLD', 'GUIDED', 'AUTO', 'RTL', 'LAND'],
    all: ['STABILIZE', 'ALT_HOLD', 'LOITER', 'POSHOLD', 'BRAKE', 'GUIDED', 'AUTO', 'CIRCLE', 'RTL', 'SMART_RTL', 'LAND', 'ACRO', 'SPORT', 'DRIFT', 'AUTOTUNE'],
  },
  plane: { quick: ['MANUAL', 'FBWA', 'FBWB', 'CRUISE', 'LOITER', 'GUIDED', 'AUTO', 'RTL'], all: PLANE_ALL },
  quadplane: {
    quick: ['QHOVER', 'QLOITER', 'QLAND', 'QRTL', 'FBWA', 'LOITER', 'AUTO', 'RTL'],
    all: [...PLANE_ALL, 'QSTABILIZE', 'QHOVER', 'QLOITER', 'QLAND', 'QRTL', 'QAUTOTUNE', 'QACRO'],
  },
  rover: {
    quick: ['MANUAL', 'ACRO', 'HOLD', 'LOITER', 'GUIDED', 'AUTO', 'RTL', 'SMART_RTL'],
    all: ['MANUAL', 'ACRO', 'STEERING', 'HOLD', 'LOITER', 'FOLLOW', 'SIMPLE', 'CIRCLE', 'GUIDED', 'AUTO', 'RTL', 'SMART_RTL', 'DOCK'],
  },
}

/** The modes for a vehicle; 'other' gets the copter set, like its icon and model. */
export function modesFor(v: Pick<VehicleState, 'kind' | 'vtol'>): FrameModes {
  if (v.kind === 'plane') return v.vtol ? MODES.quadplane : MODES.plane
  return v.kind === 'rover' ? MODES.rover : MODES.copter
}

/** How an airframe takes off (ArduPilot): copter / QuadPlane climb to an altitude in GUIDED,
 * a plain fixed wing flies TAKEOFF mode up to its TKOFF_ALT, a rover never. */
export type TakeoffKind = 'climb' | 'tkoff_alt'

export function takeoffKind(v: Pick<VehicleState, 'kind' | 'vtol'>): TakeoffKind | null {
  if (v.kind === 'copter') return 'climb'
  if (v.kind === 'plane') return v.vtol ? 'climb' : 'tkoff_alt'
  return null
}

/** Where the takeoff altitude input starts (m above home). A fixed wing's command carries it too; the vehicle ignores it. */
export const TAKEOFF_ALT_DEFAULT = 30

export type CommandGroup = 'flight' | 'move' | 'mode' | 'payload'
export type ModalTarget = 'guided' | 'camera'

export interface BuildCtx {
  readonly mode?: string
  readonly value?: number
}

export interface CatalogItem {
  readonly name: string
  readonly group: CommandGroup
  readonly enabled: (v: VehicleState) => boolean
  /** Present for commands sent through the queue; absent for items that open a modal. */
  readonly build?: (ctx: BuildCtx) => VehicleCommand | null
  readonly opens?: ModalTarget
  /** Inline parameter the sheet renders before the button. */
  readonly param?: 'mode' | 'alt' | 'speed' | 'takeoff'
  /** Absent means every airframe has it. */
  readonly available?: (v: VehicleState) => boolean
  /** Button title while disabled. */
  readonly disabledHint?: keyof Dict
}

export function commandName(c: VehicleCommand): string {
  return c.cmd
}

const always = () => true
/** Every airframe but a rover leaves the ground. */
export const flies = (v: Pick<VehicleState, 'kind'>): boolean => v.kind !== 'rover'
const simple = (cmd: 'pause' | 'resume' | 'rtl' | 'land' | 'mission_start' | 'mission_resume' | 'arm' | 'disarm') => (): VehicleCommand => ({ cmd })

const numeric = (value: number | undefined): value is number => value !== undefined && !Number.isNaN(value)

export const CATALOG: readonly CatalogItem[] = [
  // arm / disarm first: takeoff waits for an arm
  { name: 'arm', group: 'flight', enabled: (v) => !v.armed, build: simple('arm') },
  { name: 'disarm', group: 'flight', enabled: (v) => v.armed, build: simple('disarm') },
  {
    name: 'takeoff',
    group: 'flight',
    enabled: (v) => v.armed,
    available: (v) => takeoffKind(v) !== null,
    disabledHint: 'armFirst',
    param: 'takeoff',
    build: ({ value }) => (numeric(value) ? { cmd: 'takeoff', args: { alt_rel: value } } : null),
  },
  { name: 'pause', group: 'flight', enabled: always, build: simple('pause') },
  { name: 'resume', group: 'flight', enabled: always, build: simple('resume') },
  { name: 'rtl', group: 'flight', enabled: always, build: simple('rtl') },
  // a rover cannot land or change altitude
  { name: 'land', group: 'flight', enabled: always, available: flies, build: simple('land') },
  { name: 'guided', group: 'move', enabled: always, opens: 'guided' },
  {
    name: 'change_alt',
    group: 'move',
    enabled: always,
    available: flies,
    param: 'alt',
    build: ({ value }) => (value === undefined || Number.isNaN(value) ? null : { cmd: 'change_alt', args: { alt_rel: value } }),
  },
  {
    name: 'change_speed',
    group: 'move',
    enabled: always,
    param: 'speed',
    build: ({ value }) => (value === undefined || Number.isNaN(value) ? null : { cmd: 'change_speed', args: { mps: value } }),
  },
  { name: 'set_mode', group: 'mode', enabled: always, param: 'mode', build: ({ mode }) => (mode ? { cmd: 'set_mode', args: { mode } } : null) },
  { name: 'mission_start', group: 'mode', enabled: always, build: simple('mission_start') },
  { name: 'mission_resume', group: 'mode', enabled: always, build: simple('mission_resume') },
  // カメラ・ジンバル opens the camera settings; the dead 「その他の対応コマンド」 is gone.
  { name: 'camera', group: 'payload', enabled: always, opens: 'camera' },
]

const GROUP_ORDER: readonly CommandGroup[] = ['flight', 'move', 'mode', 'payload']

export function catalogGroups(items: readonly CatalogItem[] = CATALOG): readonly { group: CommandGroup; items: readonly CatalogItem[] }[] {
  return GROUP_ORDER.map((group) => ({ group, items: items.filter((i) => i.group === group) })).filter((g) => g.items.length > 0)
}
