import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { t } from '../../shared/i18n'
import { transferPercent } from './transfer'
import { TransferBar } from './TransferBar'

describe('TransferBar', () => {
  it('fills 0–70 % while writing and 70–100 % while reading back', () => {
    expect(transferPercent({ phase: 'write', done: 0, total: 21 })).toBe(0)
    expect(transferPercent({ phase: 'write', done: 21, total: 21 })).toBe(70)
    expect(transferPercent({ phase: 'verify', done: 21, total: 21 })).toBe(100)
    expect(transferPercent({ phase: 'done', done: 21, total: 21 })).toBe(100)
  })
  it('labels the phase with item counts', () => {
    render(<TransferBar transfer={{ phase: 'write', done: 12, total: 21 }} dict={t('ja')} />)
    const bar = screen.getByRole('progressbar', { name: 'ミッション書込' })
    expect(bar).toHaveAttribute('aria-valuenow', '40')
    expect(bar).toHaveTextContent('書込中 12 / 21')
  })
  it('shows nothing once the transfer is over', () => {
    const { container } = render(<TransferBar transfer={{ phase: 'failed', done: 0, total: 21 }} dict={t('ja')} />)
    expect(container).toBeEmptyDOMElement()
  })
})
