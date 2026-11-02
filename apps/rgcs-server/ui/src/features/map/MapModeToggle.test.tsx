import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { MapModeToggle } from './MapModeToggle'

const dict = t('ja')

describe('MapModeToggle', () => {
  it('slides the lens to the active mode and reports picks', () => {
    const onChange = vi.fn()
    const { container, rerender } = render(<MapModeToggle mode="2d" available dict={dict} onChange={onChange} />)
    expect((container.querySelector('.lens') as HTMLElement).style.transform).toBe('translateX(0)')
    fireEvent.click(screen.getByRole('button', { name: '3D' }))
    expect(onChange).toHaveBeenCalledWith('3d')
    rerender(<MapModeToggle mode="3d" available dict={dict} onChange={onChange} />)
    expect((container.querySelector('.lens') as HTMLElement).style.transform).toBe('translateX(100%)')
    expect(screen.getByRole('button', { name: '3D' }).className).toBe('on')
  })
  it('disables 3D without terrain tiles and says why', () => {
    const onChange = vi.fn()
    render(<MapModeToggle mode="2d" available={false} dict={dict} onChange={onChange} />)
    const b = screen.getByRole('button', { name: '3D' })
    expect(b).toHaveAttribute('aria-disabled', 'true')
    expect(b.title).toBe(dict.map3dUnavailable)
    fireEvent.click(b)
    expect(onChange).not.toHaveBeenCalled()
  })
})
