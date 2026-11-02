import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { View } from './view'
import { useOpsArrival } from './opsArrival'

describe('useOpsArrival', () => {
  it('counts each switch into the operations view, not the start or other switches', () => {
    const { result, rerender } = renderHook(({ view }: { view: View }) => useOpsArrival(view), { initialProps: { view: 'ops' as View } })
    expect(result.current).toBe(0)
    rerender({ view: 'mission' })
    expect(result.current).toBe(0)
    rerender({ view: 'ops' })
    expect(result.current).toBe(1)
    rerender({ view: 'ops' })
    expect(result.current).toBe(1)
    rerender({ view: 'maint' })
    rerender({ view: 'ops' })
    expect(result.current).toBe(2)
  })
})
