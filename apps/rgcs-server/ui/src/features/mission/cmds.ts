// MAV_CMD table for the mission editor, ported from the design prototype's CMDS / FRAMES tables. `p` is the MAVLink param index: 1–4 → params[], 5/6/7 → lat/lon/alt.
import type { MissionFrame, VehicleKind } from '../../shared/api/types'

export type FieldType = 'num' | 'sel' | 'tog'

export interface FieldSpec {
  readonly p: 1 | 2 | 3 | 4 | 5 | 6 | 7
  readonly key: string
  readonly type: FieldType
  readonly def: number
  readonly min?: number
  readonly max?: number
  readonly step?: number
  readonly opts?: readonly number[]
  /** Vehicle kinds that honour the param; others show it disabled as "unused". */
  readonly only?: readonly VehicleKind[]
}

export interface CmdSpec {
  readonly id: number
  readonly mav: string
  readonly pos: boolean
  readonly alt: boolean
  readonly deprecated?: boolean
  readonly fields: readonly FieldSpec[]
}

type P = FieldSpec['p']
const num = (p: P, key: string, def: number, o: Partial<FieldSpec> = {}): FieldSpec => ({ p, key, type: 'num', def, ...o })
const sel = (p: P, key: string, def: number, opts: readonly number[], o: Partial<FieldSpec> = {}): FieldSpec => ({ p, key, type: 'sel', def, opts, ...o })
const tog = (p: P, key: string, def: number, o: Partial<FieldSpec> = {}): FieldSpec => ({ p, key, type: 'tog', def, ...o })

export const CMDS: Readonly<Record<string, CmdSpec>> = {
  TAKEOFF: { id: 22, mav: 'MAV_CMD_NAV_TAKEOFF', pos: true, alt: true, fields: [] },
  WAYPOINT: {
    id: 16,
    mav: 'MAV_CMD_NAV_WAYPOINT',
    pos: true,
    alt: true,
    fields: [num(1, 'delay', 0, { min: 0, step: 1 }), num(2, 'acceptRadius', 0, { min: 0, only: ['plane', 'rover'] }), num(3, 'passRadius', 0, { only: ['plane'] })],
  },
  // Copter 4.7+: the leg into this item is a circular arc of `arcAngle` degrees (+ clockwise, ±359)
  ARC_WAYPOINT: { id: 36, mav: 'MAV_CMD_NAV_ARC_WAYPOINT', pos: true, alt: true, fields: [num(1, 'arcAngle', 0, { min: -359, max: 359, step: 1, only: ['copter'] })] },
  SPLINE_WAYPOINT: { id: 82, mav: 'MAV_CMD_NAV_SPLINE_WAYPOINT', pos: true, alt: true, fields: [num(1, 'delay', 0, { min: 0, step: 1 })] },
  // ArduPlane keeps only param3's sign for LOITER_TIME (negative = counter-clockwise); the radius is WP_LOITER_RAD
  LOITER_TIME: { id: 19, mav: 'MAV_CMD_NAV_LOITER_TIME', pos: true, alt: true, fields: [num(1, 'time', 10, { min: 0, step: 1 }), num(3, 'ccwSign', 0, { step: 1, only: ['plane'] })] },
  LOITER_TURNS: { id: 18, mav: 'MAV_CMD_NAV_LOITER_TURNS', pos: true, alt: true, fields: [num(1, 'turns', 1, { min: 0, step: 0.5 }), num(3, 'radius', 20, { step: 1 })] },
  LOITER_UNLIM: { id: 17, mav: 'MAV_CMD_NAV_LOITER_UNLIM', pos: true, alt: true, fields: [num(3, 'radius', 0, { only: ['plane'] })] },
  LOITER_TO_ALT: {
    id: 31,
    mav: 'MAV_CMD_NAV_LOITER_TO_ALT',
    pos: true,
    alt: true,
    fields: [num(2, 'radius', 0, { step: 1, only: ['plane'] }), tog(4, 'xtrack', 0, { only: ['plane'] })],
  },
  VTOL_TAKEOFF: { id: 84, mav: 'MAV_CMD_NAV_VTOL_TAKEOFF', pos: true, alt: true, fields: [] },
  VTOL_LAND: { id: 85, mav: 'MAV_CMD_NAV_VTOL_LAND', pos: true, alt: false, fields: [tog(1, 'fwApproach', 0, { only: ['plane'] })] },
  LAND: { id: 21, mav: 'MAV_CMD_NAV_LAND', pos: true, alt: false, fields: [num(1, 'abortAlt', 0, { min: 0, only: ['plane'] })] },
  RTL: { id: 20, mav: 'MAV_CMD_NAV_RETURN_TO_LAUNCH', pos: false, alt: false, fields: [] },
  NAV_DELAY: {
    id: 93,
    mav: 'MAV_CMD_NAV_DELAY',
    pos: false,
    alt: false,
    fields: [num(1, 'secs', 10, { min: -1, step: 1 }), num(2, 'hourUtc', -1, { min: -1, max: 23, step: 1 }), num(3, 'minUtc', -1, { min: -1, max: 59, step: 1 }), num(4, 'secUtc', -1, { min: -1, max: 59, step: 1 })],
  },
  DO_SET_ROI: { id: 201, mav: 'MAV_CMD_DO_SET_ROI', pos: true, alt: true, fields: [] },
  DO_CHANGE_SPEED: {
    id: 178,
    mav: 'MAV_CMD_DO_CHANGE_SPEED',
    pos: false,
    alt: false,
    fields: [sel(1, 'speedType', 1, [0, 1, 2, 3]), num(2, 'speed', 8, { min: -2, step: 0.5 }), num(3, 'throttle', -1, { min: -1, max: 100, step: 1 })],
  },
  DO_SET_CAM_TRIGG_DIST: { id: 206, mav: 'MAV_CMD_DO_SET_CAM_TRIGG_DIST', pos: false, alt: false, fields: [num(1, 'dist', 20, { min: 0, step: 1 }), tog(3, 'triggerNow', 0)] },
  DO_DIGICAM_CONTROL: {
    id: 203,
    mav: 'MAV_CMD_DO_DIGICAM_CONTROL',
    pos: false,
    alt: false,
    fields: [tog(5, 'shoot', 1), tog(1, 'session', 0), num(3, 'zoomStep', 0, { min: -1, max: 1, step: 1 }), sel(4, 'focusLock', 0, [0, 1, 2])],
  },
  DO_GIMBAL_MANAGER_PITCHYAW: {
    id: 1000,
    mav: 'MAV_CMD_DO_GIMBAL_MANAGER_PITCHYAW',
    pos: false,
    alt: false,
    fields: [
      num(1, 'pitch', -45, { min: -90, max: 90, step: 1 }),
      num(2, 'yaw', 0, { min: -180, max: 180, step: 1 }),
      num(3, 'pitchRate', 0, { step: 1 }),
      num(4, 'yawRate', 0, { step: 1 }),
      sel(5, 'gimbalFlags', 0, [0, 16]),
      num(7, 'gimbalId', 0, { min: 0, step: 1 }),
    ],
  },
  DO_MOUNT_CONTROL: {
    id: 205,
    mav: 'MAV_CMD_DO_MOUNT_CONTROL',
    pos: false,
    alt: false,
    deprecated: true,
    fields: [num(1, 'pitch', -45, { min: -90, max: 90, step: 1 }), num(2, 'roll', 0, { min: -180, max: 180, step: 1 }), num(3, 'yaw', 0, { min: -180, max: 180, step: 1 }), sel(7, 'mountMode', 2, [0, 1, 2, 3, 4])],
  },
  DO_SET_SERVO: { id: 183, mav: 'MAV_CMD_DO_SET_SERVO', pos: false, alt: false, fields: [num(1, 'servo', 9, { min: 1, max: 16, step: 1 }), num(2, 'pwm', 1500, { min: 800, max: 2200, step: 10 })] },
  DO_REPEAT_SERVO: {
    id: 184,
    mav: 'MAV_CMD_DO_REPEAT_SERVO',
    pos: false,
    alt: false,
    fields: [num(1, 'servo', 9, { min: 1, max: 16, step: 1 }), num(2, 'pwm', 1700, { min: 800, max: 2200, step: 10 }), num(3, 'cycles', 2, { min: 1, step: 1 }), num(4, 'cycleTime', 2, { min: 0, step: 0.5 })],
  },
  DO_SET_RELAY: { id: 181, mav: 'MAV_CMD_DO_SET_RELAY', pos: false, alt: false, fields: [num(1, 'relay', 0, { min: 0, max: 5, step: 1 }), tog(2, 'relayState', 1)] },
  DO_REPEAT_RELAY: {
    id: 182,
    mav: 'MAV_CMD_DO_REPEAT_RELAY',
    pos: false,
    alt: false,
    fields: [num(1, 'relay', 0, { min: 0, max: 5, step: 1 }), num(2, 'cycles', 2, { min: 1, step: 1 }), num(3, 'cycleTime', 2, { min: 0, step: 0.5 })],
  },
  DO_GRIPPER: { id: 211, mav: 'MAV_CMD_DO_GRIPPER', pos: false, alt: false, fields: [num(1, 'gripperNo', 1, { min: 1, step: 1 }), sel(2, 'gripperAction', 1, [0, 1])] },
  DO_AUX_FUNCTION: { id: 218, mav: 'MAV_CMD_DO_AUX_FUNCTION', pos: false, alt: false, fields: [num(1, 'auxFn', 0, { min: 0, step: 1 }), sel(2, 'switchPos', 2, [0, 1, 2])] },
  DO_FENCE_ENABLE: { id: 207, mav: 'MAV_CMD_DO_FENCE_ENABLE', pos: false, alt: false, fields: [sel(1, 'fenceEnable', 1, [0, 1, 2])] },
  DO_VTOL_TRANSITION: { id: 3000, mav: 'MAV_CMD_DO_VTOL_TRANSITION', pos: false, alt: false, fields: [sel(1, 'vtolState', 3, [3, 4], { only: ['plane'] })] },
  DO_LAND_START: { id: 189, mav: 'MAV_CMD_DO_LAND_START', pos: false, alt: false, fields: [] },
  CONDITION_DELAY: { id: 112, mav: 'MAV_CMD_CONDITION_DELAY', pos: false, alt: false, fields: [num(1, 'delay', 5, { min: 0, step: 1 })] },
  CONDITION_DISTANCE: { id: 114, mav: 'MAV_CMD_CONDITION_DISTANCE', pos: false, alt: false, fields: [num(1, 'dist', 50, { min: 0, step: 1 })] },
  CONDITION_YAW: {
    id: 115,
    mav: 'MAV_CMD_CONDITION_YAW',
    pos: false,
    alt: false,
    fields: [num(1, 'angle', 0, { min: 0, max: 360, step: 1 }), num(2, 'rate', 0, { min: 0, step: 1 }), sel(3, 'dir', 1, [-1, 0, 1]), sel(4, 'relative', 0, [0, 1])],
  },
  DO_JUMP: { id: 177, mav: 'MAV_CMD_DO_JUMP', pos: false, alt: false, fields: [num(1, 'seq', 1, { min: 1, step: 1 }), num(2, 'repeat', 1, { min: -1, step: 1 })] },
}

/** Palette pseudo keys (not in CMDS): draw a survey area / take it from a KML file. */
export const SURVEY_KEY = 'SURVEY'
export const SURVEY_KML_KEY = 'SURVEY_KML'
/** Palette keys that are not mission commands. */
export const isSurveyKey = (k: string): k is typeof SURVEY_KEY | typeof SURVEY_KML_KEY => k === SURVEY_KEY || k === SURVEY_KML_KEY

export const PALETTE = {
  pos: ['WAYPOINT', 'ARC_WAYPOINT', 'SPLINE_WAYPOINT', 'TAKEOFF', 'LAND', 'LOITER_TIME', 'LOITER_TURNS', 'LOITER_UNLIM', 'LOITER_TO_ALT', 'VTOL_TAKEOFF', 'VTOL_LAND', 'DO_SET_ROI', SURVEY_KEY, SURVEY_KML_KEY],
  do: [
    'DO_CHANGE_SPEED',
    'DO_SET_CAM_TRIGG_DIST',
    'DO_DIGICAM_CONTROL',
    'DO_GIMBAL_MANAGER_PITCHYAW',
    'DO_MOUNT_CONTROL',
    'DO_SET_SERVO',
    'DO_REPEAT_SERVO',
    'DO_SET_RELAY',
    'DO_REPEAT_RELAY',
    'DO_GRIPPER',
    'DO_AUX_FUNCTION',
    'DO_FENCE_ENABLE',
    'DO_LAND_START',
    'DO_VTOL_TRANSITION',
    'RTL',
  ],
  cond: ['CONDITION_DELAY', 'CONDITION_DISTANCE', 'CONDITION_YAW', 'NAV_DELAY', 'DO_JUMP'],
} as const

type Palette = { readonly [G in keyof typeof PALETTE]: readonly string[] }

const VTOL_ONLY = ['VTOL_TAKEOFF', 'VTOL_LAND', 'DO_VTOL_TRANSITION']
/** Palette keys an airframe does not fly: a rover never leaves the ground. */
function hiddenFor(kind: VehicleKind, vtol: boolean): readonly string[] {
  if (kind === 'rover') return ['TAKEOFF', 'LAND', 'LOITER_TO_ALT', 'ARC_WAYPOINT', 'DO_LAND_START', ...VTOL_ONLY]
  if (kind === 'plane') return vtol ? ['ARC_WAYPOINT'] : ['ARC_WAYPOINT', ...VTOL_ONLY]
  return ['LOITER_TO_ALT', ...VTOL_ONLY]
}

/** The palette for the write target's airframe; every command when there is no target. */
export function paletteFor(kind: VehicleKind | null, vtol: boolean): Palette {
  if (kind === null) return PALETTE
  const hidden = new Set(hiddenFor(kind, vtol))
  const keep = (keys: readonly string[]) => keys.filter((k) => !hidden.has(k))
  return { pos: keep(PALETTE.pos), do: keep(PALETTE.do), cond: keep(PALETTE.cond) }
}

export const FRAMES: Readonly<Record<MissionFrame, { readonly mav: number; readonly name: string; readonly short: string }>> = {
  rel: { mav: 3, name: 'MAV_FRAME_GLOBAL_RELATIVE_ALT', short: 'REL' },
  abs: { mav: 0, name: 'MAV_FRAME_GLOBAL', short: 'ABS' },
  ter: { mav: 10, name: 'MAV_FRAME_GLOBAL_TERRAIN_ALT', short: 'TER' },
}

const BY_ID: ReadonlyMap<number, string> = new Map(Object.entries(CMDS).map(([key, spec]) => [spec.id, key]))

export function cmdKeyOf(id: number): string | null {
  return BY_ID.get(id) ?? null
}

/** The command's fields, each flagged `unused` when `kind` does not honour it. Unknown key → []. */
export function fieldsOf(key: string, kind: VehicleKind | null): readonly (FieldSpec & { readonly unused: boolean })[] {
  const spec = CMDS[key]
  if (!spec) return []
  return spec.fields.map((f) => ({ ...f, unused: kind !== null && f.only !== undefined && !f.only.includes(kind) }))
}

/** Memory convention: the full MAV_CMD name shrinks with its length instead of wrapping. */
export function mavFontSize(name: string): string {
  const n = name.length
  return n <= 16 ? '10px' : n <= 22 ? '9px' : n <= 28 ? '8px' : '7px'
}

/** Unit per field key (language independent; labels come from the dictionary `fld_<key>`). */
export const UNITS: Readonly<Record<string, string>> = {
  alt: 'm', delay: 's', acceptRadius: 'm', passRadius: 'm', time: 's', radius: 'm', abortAlt: 'm', secs: 's', speed: 'm/s', throttle: '%',
  dist: 'm', pwm: 'µs', cycleTime: 's', pitch: '°', roll: '°', yaw: '°', pitchRate: '°/s', yawRate: '°/s', angle: '°', rate: '°/s', arcAngle: '°',
}

/** Nav commands that carry a position but are not "waypoints" in the summary count. */
export const isPosKey = (key: string): boolean => CMDS[key]?.pos === true
