import { fireEvent, render, renderHook, act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { SurveyFootToggle } from './SurveyFootToggle'
import { useFootToggle } from './useFootToggle'

const dict = t('ja')

describe('useFootToggle', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('is off by default and remembers the choice in rgcs.surveyFoot', () => {
    const a = renderHook(() => useFootToggle())
    expect(a.result.current.on).toBe(false)
    act(() => a.result.current.toggle())
    expect(a.result.current.on).toBe(true)
    expect(localStorage.getItem('rgcs.surveyFoot')).toBe('1')
    const b = renderHook(() => useFootToggle())
    expect(b.result.current.on).toBe(true)
  })

  it('blocked storage still toggles for the session', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const a = renderHook(() => useFootToggle())
    expect(a.result.current.on).toBe(false)
    act(() => a.result.current.toggle())
    expect(a.result.current.on).toBe(true)
  })
})

describe('SurveyFootToggle', () => {
  it('a pressed map button with the grid icon; hidden without surveys', () => {
    const onToggle = vi.fn()
    const { rerender } = render(<SurveyFootToggle visible on={false} onToggle={onToggle} dict={dict} />)
    const btn = screen.getByRole('button', { name: dict.svFootToggle })
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(btn.querySelector('svg.lucide-grid3x3, svg.lucide-grid-3x3')).not.toBeNull()
    fireEvent.click(btn)
    expect(onToggle).toHaveBeenCalled()
    rerender(<SurveyFootToggle visible on onToggle={onToggle} dict={dict} />)
    expect(screen.getByRole('button', { name: dict.svFootToggle }).getAttribute('aria-pressed')).toBe('true')
    rerender(<SurveyFootToggle visible={false} on onToggle={onToggle} dict={dict} />)
    expect(screen.queryByRole('button', { name: dict.svFootToggle })).toBeNull()
  })
})
