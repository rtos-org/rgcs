import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import type { VehicleState } from '../../shared/api/types'
import { fleetSkipped, fleetTargets, runFleet } from './fleet'

const v = (sysid: number, link: VehicleState['link'] = 'ok', armed = true) => ({ sysid, name: `UAV-0${sysid}`, link, armed }) as VehicleState

describe('fleetTargets', () => {
  it('is every armed vehicle with a link, by sysid', () => {
    expect(fleetTargets([v(3), v(1, 'delay'), v(2, 'lost')]).map((x) => x.sysid)).toEqual([1, 3])
  })
  it('leaves vehicles on the pad alone (pause = BRAKE, which then refuses to arm)', () => {
    expect(fleetTargets([v(1), v(2, 'ok', false)]).map((x) => x.sysid)).toEqual([1])
  })
})

describe('fleetSkipped', () => {
  it('names every vehicle left out and why: lost link first, else disarmed', () => {
    expect(fleetSkipped([v(3, 'ok', false), v(1), v(2, 'lost', true)]).map((s) => [s.vehicle.sysid, s.reason])).toEqual([
      [2, 'lost'],
      [3, 'disarmed'],
    ])
  })
})

describe('runFleet', () => {
  it('confirms and sends to each vehicle; one refusal does not stop the others', async () => {
    const confirm = vi.fn(async (sysid: number) => ({ confirm_token: `tok${sysid}`, expires_in: 30 }))
    const send = vi.fn(async (sysid: number) => {
      if (sysid === 2) throw new ApiError(409, 'vehicle_busy', 'busy')
      return { id: sysid }
    })
    const results = await runFleet({ cmd: 'disarm' }, [1, 2, 3], { confirm, send })
    expect(send).toHaveBeenCalledWith(1, { cmd: 'disarm' }, 'tok1')
    expect(send).toHaveBeenCalledWith(3, { cmd: 'disarm' }, 'tok3')
    expect(results).toEqual([
      { sysid: 1, ok: true },
      { sysid: 2, ok: false, message: 'busy' },
      { sysid: 3, ok: true },
    ])
  })
  it('a command without a confirm rule is sent without a token', async () => {
    const confirm = vi.fn()
    const send = vi.fn(async () => ({ id: 1 }))
    await runFleet({ cmd: 'pause' }, [1], { confirm, send })
    expect(confirm).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(1, { cmd: 'pause' }, undefined)
  })
  it('RTL needs no token any more', async () => {
    const confirm = vi.fn()
    const send = vi.fn(async () => ({ id: 1 }))
    await runFleet({ cmd: 'rtl' }, [1], { confirm, send })
    expect(confirm).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(1, { cmd: 'rtl' }, undefined)
  })
  it('a failed token request fails only that vehicle', async () => {
    const confirm = vi.fn(async (sysid: number) => {
      if (sysid === 1) throw new Error('offline')
      return { confirm_token: 't', expires_in: 30 }
    })
    const send = vi.fn(async () => ({ id: 1 }))
    expect(await runFleet({ cmd: 'disarm' }, [1, 2], { confirm, send })).toEqual([
      { sysid: 1, ok: false, message: 'offline' },
      { sysid: 2, ok: true },
    ])
  })
})
