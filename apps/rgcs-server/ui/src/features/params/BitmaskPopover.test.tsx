import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { BitmaskPopover } from './BitmaskPopover'

const bits = { '0': 'Fast Attitude', '1': 'Medium Attitude', '2': 'GPS' }

describe('BitmaskPopover', () => {
  it('popover_checks_set_bits_and_applies_the_decimal_value', () => {
    const onApply = vi.fn()
    render(<BitmaskPopover name="LOG_BITMASK" value={5} bits={bits} dict={t('ja')} onApply={onApply} onClose={() => {}} />)
    expect(screen.getByRole('checkbox', { name: /Fast Attitude/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Medium Attitude/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /GPS/ })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: /Medium Attitude/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Fast Attitude/ }))
    expect(screen.getByTestId('bits-value')).toHaveTextContent('6')
    fireEvent.click(screen.getByRole('button', { name: '適用' }))
    expect(onApply).toHaveBeenCalledWith(6)
  })

  it('unknown_bits_are_kept_and_shown', () => {
    const onApply = vi.fn()
    render(<BitmaskPopover name="X" value={1 + 16} bits={bits} dict={t('ja')} onApply={onApply} onClose={() => {}} />)
    expect(screen.getByText(/未定義のビット/)).toHaveTextContent('4')
    fireEvent.click(screen.getByRole('checkbox', { name: /GPS/ }))
    fireEvent.click(screen.getByRole('button', { name: '適用' }))
    expect(onApply).toHaveBeenCalledWith(1 + 4 + 16)
  })

  it('cancel_closes_without_applying', () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(<BitmaskPopover name="X" value={0} bits={bits} dict={t('ja')} onApply={onApply} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onClose).toHaveBeenCalled()
    expect(onApply).not.toHaveBeenCalled()
  })
})
