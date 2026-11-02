// One-click fixes for validation findings (server `Finding`s and the planner's own warnings).
// Each fix is a pure Draft → Draft step, applied through the editor so it can be undone.
import type { MissionItem, StoredParam } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { cmdKeyOf, fieldsOf } from './cmds'
import { fieldLabel, shortNum, wpLabel } from './labels'
import { insertCommandAfter, removeItems, surveyLocked, updateItem, type Draft, type DraftItem, type TakeoffKey } from './model'

export interface FindingFix {
  readonly label: string
  readonly apply: (d: Draft) => Draft
}

export interface FixInput {
  readonly code: string
  readonly seq: number | null
  readonly param?: StoredParam
}

export interface FixContext {
  /** The takeoff this airframe starts with (none for a rover). */
  readonly takeoff: TakeoffKey | null
  readonly dict: Dict
}

/**
 * A value in the wrong param slot, by command: the slot ArduPilot actually reads. Mission Planner
 * labelled LOITER_TO_ALT's param1 "Radius" from 2025-01 to 2025-10 (mavcmd.xml 366c7e8fca,
 * reverted in a3f720ad65); ArduPilot reads the radius from param2 (AP_Mission.cpp:1234).
 */
const MISPLACED: Readonly<Record<number, { readonly from: number; readonly to: number }>> = { 31: { from: 1, to: 2 } }

function slotPatch(it: MissionItem, index: number, value: number): Partial<MissionItem> {
  if (index === 5) return { lat: value }
  if (index === 6) return { lon: value }
  if (index === 7) return { alt: value }
  const params = [...it.params] as [number, number, number, number]
  params[index - 1] = value
  return { params }
}

function paramFix(it: DraftItem, p: StoredParam, dict: Dict): FindingFix {
  const move = MISPLACED[it.command]
  if (move && move.from === p.index && it.params[move.to - 1] === 0) {
    const key = cmdKeyOf(it.command) ?? ''
    const field = fieldsOf(key, null).find((f) => f.p === move.to)
    const name = field ? fieldLabel(field.key, dict) : dict.fParamN.replace('{n}', String(move.to))
    return {
      label: dict.fixMoveTo.replace('{field}', name),
      apply: (d) => updateItem(d, it.uid, { params: moved(it.params, move.from, move.to) }),
    }
  }
  return { label: dict.fixSetTo.replace('{v}', shortNum(p.stored)), apply: (d) => updateItem(d, it.uid, slotPatch(it, p.index, p.stored)) }
}

function moved(params: MissionItem['params'], from: number, to: number): MissionItem['params'] {
  const out = [...params] as MissionItem['params']
  out[to - 1] = params[from - 1] ?? 0
  out[from - 1] = 0
  return out
}

function prepend(d: Draft, key: TakeoffKey): Draft {
  const added = insertCommandAfter(d, null, key)
  const last = added.items[added.items.length - 1]
  if (!last || added === d) return d
  return { ...added, items: [{ ...last, lat: 0, lon: 0 }, ...added.items.slice(0, -1)] }
}

/** The fix for a finding, or `null` when there is no safe one-click fix. */
export function findingFix(f: FixInput, d: Draft, { takeoff, dict }: FixContext): FindingFix | null {
  const it = f.seq !== null ? d.items[f.seq - 1] : undefined
  const cmd = (key: string) => wpLabel(key, dict)
  switch (f.code) {
    case 'param_ignored':
      return it && f.param && !surveyLocked(d).has(it.uid) ? paramFix(it, f.param, dict) : null
    case 'first_not_takeoff':
      return takeoff ? { label: dict.fixAddFirst.replace('{cmd}', cmd(takeoff)), apply: (x) => prepend(x, takeoff) } : null
    case 'no_land_or_rtl':
      return { label: dict.fixAddLast.replace('{cmd}', cmd('RTL')), apply: (x) => insertCommandAfter(x, null, 'RTL') }
    case 'rover_takeoff':
      return it ? { label: dict.fixRemove.replace('{cmd}', cmd(cmdKeyOf(it.command) ?? 'TAKEOFF')), apply: (x) => removeItems(x, new Set([it.uid])) } : null
    default:
      return null
  }
}
