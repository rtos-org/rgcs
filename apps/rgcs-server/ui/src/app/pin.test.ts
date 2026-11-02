import { describe, expect, it } from 'vitest'
import { panelSysid, togglePin } from './pin'

const has = (...ids: number[]) => (id: number) => ids.includes(id)

describe('panelSysid', () => {
  it('shows the selected vehicle unless one is pinned', () => {
    expect(panelSysid(null, 2, has(1, 2))).toBe(2)
    expect(panelSysid(1, 2, has(1, 2))).toBe(1)
    expect(panelSysid(null, null, has(1))).toBeNull()
    expect(panelSysid(1, null, has(1))).toBe(1)
  })
  it('a pinned vehicle that is gone falls back to the selection', () => {
    expect(panelSysid(3, 2, has(1, 2))).toBe(2)
  })
})

describe('togglePin', () => {
  it('pins the shown vehicle, or unpins it', () => {
    expect(togglePin(null, 4)).toBe(4)
    expect(togglePin(4, 4)).toBeNull()
    expect(togglePin(4, 5)).toBe(5)
  })
})
