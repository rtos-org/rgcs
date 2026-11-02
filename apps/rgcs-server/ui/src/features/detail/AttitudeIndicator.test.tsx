import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { t } from '../../shared/i18n'
import { AttitudeIndicator } from './AttitudeIndicator'
import { horizonTransform } from './instruments'

const dict = t('ja')

describe('AttitudeIndicator', () => {
  it('rotates and shifts the horizon for the given roll and pitch', () => {
    render(<AttitudeIndicator roll={-12} pitch={4} dict={dict} />)
    const svg = screen.getByRole('img', { name: /姿勢/ })
    expect(svg.querySelector('[data-part="horizon"]')).toHaveAttribute('transform', horizonTransform(-12, 4))
    expect(svg.querySelector('[data-part="roll-pointer"]')).toHaveAttribute('transform', 'rotate(12)')
    expect(svg).not.toHaveClass('nodata')
    expect(svg.querySelectorAll('[data-part="roll-tick"]')).toHaveLength(11)
    expect(svg.querySelectorAll('[data-part="pitch-mark"]').length).toBeGreaterThanOrEqual(6)
  })

  it('shows a dimmed level horizon without NaN when there is no attitude', () => {
    const { container } = render(<AttitudeIndicator roll={null} pitch={null} dict={dict} />)
    const svg = screen.getByRole('img', { name: /姿勢/ })
    expect(svg).toHaveClass('nodata')
    expect(svg.querySelector('[data-part="horizon"]')).toHaveAttribute('transform', horizonTransform(0, 0))
    expect(container.innerHTML).not.toContain('NaN')
  })
})
