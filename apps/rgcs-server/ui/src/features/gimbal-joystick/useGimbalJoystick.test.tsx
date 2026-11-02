import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientMessage } from '../../shared/api/types'
import { DEFAULT_PROFILE } from './profile'

const sent: ClientMessage[] = []
vi.mock('../vehicles/store', () => ({ vehicleStore: { send: (m: ClientMessage) => (sent.push(m), true) } }))
const { useGimbalJoystick } = await import('./useGimbalJoystick')

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useGimbalJoystick', () => {
  afterEach(() => {
    sent.length = 0
    setVisibility('visible')
  })

  it('re-targets the currently selected vehicle when the tab comes back, not the one selected at mount', () => {
    const { rerender, unmount } = renderHook(({ sysid }: { sysid: number | null }) => useGimbalJoystick(sysid, DEFAULT_PROFILE, () => {}), {
      initialProps: { sysid: 1 },
    })
    rerender({ sysid: 2 })
    sent.length = 0
    act(() => setVisibility('hidden'))
    act(() => setVisibility('visible'))
    expect(sent.filter((m) => m.t === 'select')).toEqual([{ t: 'select', sysid: 2 }])
    unmount()
  })
})
