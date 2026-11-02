import { describe, expect, it } from 'vitest'
import { CMDS, FRAMES, PALETTE, cmdKeyOf, fieldsOf, paletteFor } from './cmds'

describe('mission command table', () => {
  it('takeoff_and_waypoint_have_the_prototype_ids', () => {
    expect(CMDS.TAKEOFF?.id).toBe(22)
    expect(CMDS.WAYPOINT?.id).toBe(16)
    expect(CMDS.WAYPOINT?.mav).toBe('MAV_CMD_NAV_WAYPOINT')
    expect(CMDS.DO_JUMP?.id).toBe(177)
    expect(FRAMES.ter.mav).toBe(10)
    expect(FRAMES.rel.name).toBe('MAV_FRAME_GLOBAL_RELATIVE_ALT')
    expect(cmdKeyOf(20)).toBe('RTL')
    expect(cmdKeyOf(9999)).toBeNull()
    expect(PALETTE.pos).toContain('WAYPOINT')
    expect(PALETTE.cond).toContain('DO_JUMP')
    expect(Object.keys(CMDS)).toHaveLength(32) // + ARC_WAYPOINT (2026-10-19), plane / QuadPlane commands (2026-10-20)
  })

  it('the palette offers only what the target airframe flies', () => {
    const rover = paletteFor('rover', false).pos
    for (const k of ['TAKEOFF', 'LAND', 'LOITER_TO_ALT', 'VTOL_TAKEOFF', 'VTOL_LAND']) expect(rover).not.toContain(k)
    expect(rover).toContain('WAYPOINT')
    const copter = paletteFor('copter', false).pos
    expect(copter).not.toContain('VTOL_TAKEOFF')
    expect(copter).not.toContain('LOITER_TO_ALT')
    expect(copter).toContain('TAKEOFF')
    expect(paletteFor('plane', true).pos).toContain('VTOL_TAKEOFF')
    expect(paletteFor('plane', false).pos).not.toContain('VTOL_TAKEOFF')
    expect(paletteFor(null, false)).toBe(PALETTE)
  })

  it('fields_mark_params_the_vehicle_ignores_as_unused', () => {
    const copter = fieldsOf('WAYPOINT', 'copter')
    expect(copter.map((f) => [f.key, f.unused])).toEqual([
      ['delay', false],
      ['acceptRadius', true],
      ['passRadius', true],
    ])
    const plane = fieldsOf('WAYPOINT', 'plane')
    expect(plane.find((f) => f.key === 'acceptRadius')?.unused).toBe(false)
    expect(fieldsOf('WAYPOINT', null).every((f) => !f.unused)).toBe(true)
    expect(fieldsOf('NOPE', 'copter')).toEqual([])
  })

  it('has the plane / QuadPlane commands with the params ArduPlane reads (source check 2026-10-20)', () => {
    expect([CMDS.LOITER_TO_ALT?.id, CMDS.VTOL_TAKEOFF?.id, CMDS.VTOL_LAND?.id, CMDS.DO_VTOL_TRANSITION?.id]).toEqual([31, 84, 85, 3000])
    expect(fieldsOf('LOITER_TO_ALT', 'plane').map((f) => [f.p, f.key])).toEqual([
      [2, 'radius'],
      [4, 'xtrack'],
    ])
    expect(fieldsOf('LOITER_TO_ALT', 'copter').every((f) => f.unused)).toBe(true)
    expect(fieldsOf('DO_VTOL_TRANSITION', 'plane')[0]).toMatchObject({ p: 1, key: 'vtolState', opts: [3, 4] })
    expect(PALETTE.pos).toEqual(expect.arrayContaining(['LOITER_TO_ALT', 'VTOL_TAKEOFF', 'VTOL_LAND']))
    expect(PALETTE.do).toContain('DO_VTOL_TRANSITION')
    // LOITER_TIME: ArduPlane keeps only the sign of param3 (direction); the radius is WP_LOITER_RAD
    expect(fieldsOf('LOITER_TIME', 'plane').map((f) => f.key)).toEqual(['time', 'ccwSign'])
  })
})
