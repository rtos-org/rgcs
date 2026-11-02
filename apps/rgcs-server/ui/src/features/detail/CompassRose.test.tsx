import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { t } from '../../shared/i18n'
import { CompassRose } from './CompassRose'

const dict = t('ja')

describe('CompassRose', () => {
  it('draws the vehicle in the middle as its own airframe (top view, nose up)', () => {
    const parts = (frame: 'copter' | 'quadplane' | 'plane' | 'rover') => {
      const { unmount } = render(<CompassRose hdg={0} frame={frame} dict={dict} />)
      const g = screen.getByRole('img', { name: /方位/ }).querySelector('[data-part="vehicle"]')!
      const out = { frame: g.getAttribute('data-frame'), rotors: g.querySelectorAll('[data-part="rotor"]').length, wheels: g.querySelectorAll('[data-part="wheel"]').length }
      unmount()
      return out
    }
    expect(parts('copter')).toEqual({ frame: 'copter', rotors: 4, wheels: 0 })
    expect(parts('quadplane')).toEqual({ frame: 'quadplane', rotors: 4, wheels: 0 })
    expect(parts('plane')).toEqual({ frame: 'plane', rotors: 0, wheels: 0 })
    expect(parts('rover')).toEqual({ frame: 'rover', rotors: 0, wheels: 4 })
  })

  it('without a frame it keeps the plane silhouette', () => {
    render(<CompassRose hdg={0} dict={dict} />)
    expect(screen.getByRole('img', { name: /方位/ }).querySelector('[data-part="vehicle"]')).toHaveAttribute('data-frame', 'plane')
  })

  it('turns the card by −heading and keeps N highlighted', () => {
    render(<CompassRose hdg={87} dict={dict} />)
    const svg = screen.getByRole('img', { name: /方位/ })
    expect(svg.querySelector('[data-part="card"]')).toHaveAttribute('transform', 'rotate(-87)')
    expect(svg.querySelectorAll('[data-part="tick"]')).toHaveLength(12)
    const north = [...svg.querySelectorAll('text')].find((n) => n.textContent === 'N')
    expect(north).toHaveClass('north')
    expect(svg).not.toHaveClass('nodata')
  })

  it('marks the course over ground on the card when known', () => {
    const { rerender } = render(<CompassRose hdg={87} cog={95} dict={dict} />)
    expect(screen.getByRole('img', { name: /方位/ }).querySelector('[data-part="cog"]')).toHaveAttribute('transform', 'rotate(95)')
    rerender(<CompassRose hdg={87} dict={dict} />)
    expect(screen.getByRole('img', { name: /方位/ }).querySelector('[data-part="cog"]')).toBeNull()
  })

  it('shows a dimmed north-up card without NaN when the heading is unknown', () => {
    const { container } = render(<CompassRose hdg={null} cog={40} dict={dict} />)
    const svg = screen.getByRole('img', { name: /方位/ })
    expect(svg).toHaveClass('nodata')
    expect(svg.querySelector('[data-part="card"]')).toHaveAttribute('transform', 'rotate(0)')
    expect(svg.querySelector('[data-part="cog"]')).toBeNull()
    expect(container.innerHTML).not.toContain('NaN')
  })
})
