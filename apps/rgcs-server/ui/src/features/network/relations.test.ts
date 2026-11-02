import { describe, expect, it } from 'vitest'
import { clientSession, mavLink, netVehicle, topology } from './fixture'
import { toGraph } from './graph'
import { related } from './relations'

const g = toGraph(topology(1, { links: [mavLink()], vehicles: [netVehicle(1), netVehicle(2)], clients: [clientSession(1), clientSession(2)] }))

const expectAll = (set: ReadonlySet<string> | null, ids: readonly string[]) => {
  expect(set).not.toBeNull()
  ids.forEach((id) => expect(set, id).toContain(id))
}

describe('related', () => {
  it('dims nothing for the server', () => {
    expect(related('server', g)).toBeNull()
  })

  it('a vehicle lights its real route to every client', () => {
    const r = related('v:1', g)
    expectAll(r, ['v:1', 'r:1', 'e:v:1', 'link:link0', 'server', 'ws', 'c:1', 'c:2', 'e:c:1', 'e:c:2'])
    expect(r?.has('v:2')).toBe(false)
    expect(r?.has('ph:hub')).toBe(false)
    expectAll(related('e:v:1', g), ['v:1', 'server'])
    expectAll(related('r:1', g), ['v:1', 'server'])
  })

  it('a client lights its path back to every vehicle', () => {
    expectAll(related('c:1', g), ['c:1', 'e:c:1', 'ws', 'server', 'link:link0', 'e:v:1', 'e:v:2', 'v:1', 'v:2'])
    expect(related('c:1', g)?.has('c:2')).toBe(false)
  })

  it('the link lights its vehicles and the server', () => {
    expectAll(related('link:link0', g), ['link:link0', 'v:1', 'v:2', 'e:v:1', 'server'])
  })

  it('a placeholder lights the unconfigured M5 path', () => {
    expectAll(related('ph:hub', g), ['ph:hub', 'ph:lte:1', 'e:ph:lte:1', 'ph:uplink', 'ph:users', 'ph:ntrip'])
    expect(related('ph:hub', g)?.has('v:1')).toBe(false)
  })
})
