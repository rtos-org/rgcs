// Survey items: the ArduPilot MissionItem list for lanes already placed and oriented (runs).
// Positions are in the local frame of features/mission/arc.ts about `origin` (x = east, y = north).
import type { MissionItem } from '../../shared/api/types'
import { fromLocal, MAV_CMD_NAV_ARC_WAYPOINT, type Xy } from '../mission/arc'
import { CMDS } from '../mission/cmds'
import type { LatLon } from '../mission/geo'
import type { SurveySpec } from './spec'
import { arcEnd, arcStart, planTurn, splitArc, type TurnArc } from './turns'

/** One lane as flown: lead-in start → shooting start → shooting end → overshoot end. */
export interface Run {
  readonly lead: Xy
  readonly start: Xy
  readonly end: Xy
  readonly over: Xy
  /** Compass bearing of the flight direction. */
  readonly headingDeg: number
}

export interface ItemContext {
  readonly origin: LatLon
  readonly altM: number
  readonly triggerDistM: number
  readonly radiusM: number
  readonly speedMs: number
  readonly turn: SurveySpec['turn']
  readonly airframe: SurveySpec['airframe']
}

type Params = MissionItem['params']

/** A positioned step (`at` set) or a DO command (`at` null). */
interface Step {
  readonly command: number
  readonly params: Params
  readonly at: Xy | null
}

/** Turn arcs shorter than this are skipped (near-degenerate Ω); the next WP still reaches their end. */
const MIN_ARC_DEG = 1
/** A WP closer than this to the previous position is dropped. */
const SAME_WP_M = 0.5
const NO_PARAMS: Params = [0, 0, 0, 0]

const wp = (at: Xy): Step => ({ command: CMDS.WAYPOINT.id, params: NO_PARAMS, at })
/** ArduPilot stores NAV_ARC_WAYPOINT param1 as whole degrees; arcs below MIN_ARC_DEG never get here, so it is ≥ 1. */
const arcTo = (arc: TurnArc): Step => ({ command: MAV_CMD_NAV_ARC_WAYPOINT, params: [Math.round(arc.sweepDeg), 0, 0, 0], at: arcEnd(arc) })
const doCmd = (command: number, params: Params): Step => ({ command, params, at: null })

function laneSteps(run: Run, ctx: ItemContext): Step[] {
  const trig = CMDS.DO_SET_CAM_TRIGG_DIST.id
  const shoot = [wp(run.start), doCmd(trig, [ctx.triggerDistM, 0, 1, 0]), wp(run.end), doCmd(trig, NO_PARAMS)]
  return ctx.airframe === 'plane' ? [wp(run.lead), ...shoot, wp(run.over)] : shoot
}

/** WPs at each arc's start (the straight-segment ends), then the split points or one ARC item. */
function turnSteps(from: Run, to: Run, ctx: ItemContext): Step[] {
  const arcs = planTurn(from.over, to.lead, from.headingDeg, ctx.radiusM).arcs.filter((a) => Math.abs(a.sweepDeg) >= MIN_ARC_DEG)
  return arcs.flatMap((a) => [wp(arcStart(a)), ...(ctx.turn === 'split' ? splitArc(a).map(wp) : [arcTo(a)])])
}

/** Drops WPs that would repeat (< SAME_WP_M) the previous position. */
function dedupe(steps: readonly Step[]): Step[] {
  const out: Step[] = []
  let last: Xy | null = null
  for (const s of steps) {
    if (s.at && s.command === CMDS.WAYPOINT.id && last && Math.hypot(s.at.x - last.x, s.at.y - last.y) < SAME_WP_M) continue
    out.push(s)
    if (s.at) last = s.at
  }
  return out
}

function toItem(step: Step, ctx: ItemContext): MissionItem {
  const base = { command: step.command, frame: 'rel' as const, params: step.params, autocontinue: true }
  if (!step.at) return { ...base, lat: 0, lon: 0, alt: 0 }
  const p = fromLocal(ctx.origin, step.at)
  return { ...base, lat: p.lat, lon: p.lon, alt: ctx.altM }
}

/** DO_CHANGE_SPEED, then each run's lane items and (plane only) the turn to the next run. */
export function buildItems(runs: readonly Run[], ctx: ItemContext): MissionItem[] {
  const plane = ctx.airframe === 'plane'
  const speed = doCmd(CMDS.DO_CHANGE_SPEED.id, [plane ? 0 : 1, ctx.speedMs, -1, 0])
  const body = runs.flatMap((run, i) => [...laneSteps(run, ctx), ...(plane && i + 1 < runs.length ? turnSteps(run, runs[i + 1], ctx) : [])])
  return dedupe([speed, ...body]).map((s) => toItem(s, ctx))
}
