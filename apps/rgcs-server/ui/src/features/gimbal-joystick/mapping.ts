import type { ButtonFunction, GimbalInputProfile } from '../../shared/api/types'

export interface Rates {
  readonly yaw: number
  readonly pitch: number
}

/** Linear rescale outside the deadzone so full deflection still reaches ±1. */
export function applyDeadzone(value: number, deadzone: number): number {
  const mag = Math.abs(value)
  if (mag <= deadzone) return 0
  const scaled = (mag - deadzone) / (1 - deadzone)
  return Math.sign(value) * Math.min(1, scaled)
}

const clamp = (v: number) => Math.max(-100, Math.min(100, Math.round(v)))

/** Pan / tilt axes → integer rates in −100..100 (yaw = pan × max_pan_speed). */
export function axesToRates(axes: readonly number[], p: GimbalInputProfile): Rates {
  let pan = 0
  let tilt = 0
  for (const m of p.axes) {
    const raw = axes[m.axis]
    if (raw === undefined || m.fn === 'none') continue
    const v = applyDeadzone(m.invert ? -raw : raw, m.deadzone) * m.scale
    if (m.fn === 'pan') pan = v
    if (m.fn === 'tilt') tilt = v
  }
  return { yaw: clamp(pan * p.max_pan_speed), pitch: clamp(tilt * p.max_tilt_speed) }
}

/** Functions whose button went from released to pressed, in button order. */
export function buttonEdges(prev: readonly boolean[], now: readonly boolean[], p: GimbalInputProfile): ButtonFunction[] {
  return p.buttons
    .filter((m) => m.fn !== 'none' && now[m.button] === true && prev[m.button] !== true)
    .map((m) => m.fn)
}

/** Functions whose button went from pressed to released, in button order. */
export function buttonReleases(prev: readonly boolean[], now: readonly boolean[], p: GimbalInputProfile): ButtonFunction[] {
  return p.buttons
    .filter((m) => m.fn !== 'none' && prev[m.button] === true && now[m.button] !== true)
    .map((m) => m.fn)
}
