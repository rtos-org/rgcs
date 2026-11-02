import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { ShowAllButton } from './ShowAllButton'

describe('ShowAllButton', () => {
  it('is labelled 全機を表示 and fires on click', () => {
    const onClick = vi.fn()
    render(<ShowAllButton dict={t('ja')} onClick={onClick} className="float map-r top3" />)
    fireEvent.click(screen.getByRole('button', { name: '全機を表示' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
