import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { usePlace } from './usePlace'

describe('usePlace', () => {
  it('nav ai toggles the AI panel on the ops map; closeAi returns to detail', () => {
    const { result } = renderHook(() => usePlace())
    expect(result.current).toMatchObject({ view: 'ops', right: 'detail', navView: 'ops', aiOpen: false })
    act(() => result.current.nav('ai'))
    expect(result.current).toMatchObject({ view: 'ops', right: 'ai', navView: 'ai', aiOpen: true })
    act(() => result.current.closeAi())
    expect(result.current).toMatchObject({ right: 'detail', aiOpen: false })
  })

  it('setView keeps the right panel; the AI panel shows only on the ops view', () => {
    const { result } = renderHook(() => usePlace())
    act(() => result.current.nav('ai'))
    act(() => result.current.setView('maint'))
    expect(result.current).toMatchObject({ view: 'maint', right: 'ai', navView: 'maint', aiOpen: false })
    act(() => result.current.setView('ops'))
    expect(result.current.aiOpen).toBe(true)
  })
})
