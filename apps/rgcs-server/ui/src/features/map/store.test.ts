import { describe, expect, it } from 'vitest'
import { INITIAL_MAP_UI, cancelPick, clearFollow, requestFocus, select, setFollow, setTarget, startPick, toggleAside } from './store'

describe('map ui transitions', () => {
  it('follow / select / aside return new objects and are identity-stable when unchanged', () => {
    const s1 = setFollow(INITIAL_MAP_UI, 1)
    expect(s1.follow).toBe(1)
    expect(INITIAL_MAP_UI.follow).toBeNull()
    expect(clearFollow(INITIAL_MAP_UI)).toBe(INITIAL_MAP_UI)
    expect(clearFollow(s1).follow).toBeNull()
    expect(select(s1, 1).selected).toBe(1)
    expect(toggleAside(s1).aside).toBe('rail')
    expect(toggleAside(toggleAside(s1)).aside).toBe('full')
  })

  it('pick mode collects a target and cancel resets it', () => {
    const picking = startPick(INITIAL_MAP_UI, 'guided-target')
    expect(picking.pick).toBe('guided-target')
    const withTarget = setTarget(picking, { lat: 36.1, lon: 139.3 })
    expect(withTarget.target).toEqual({ lat: 36.1, lon: 139.3 })
    expect(withTarget.pick).toBe('none')
    const reset = cancelPick(withTarget)
    expect(reset.pick).toBe('none')
    expect(reset.target).toBeNull()
  })
  it('focus requests count up so the same vehicle can be focused twice', () => {
    const a = requestFocus(INITIAL_MAP_UI, 2)
    const b = requestFocus(a, 2)
    expect(a.focus).toEqual({ sysid: 2, n: 1 })
    expect(b.focus).toEqual({ sysid: 2, n: 2 })
  })
})
