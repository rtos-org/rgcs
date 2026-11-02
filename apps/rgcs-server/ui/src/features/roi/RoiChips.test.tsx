import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RoiTarget } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { emptyTargets } from './schema'
import { RoiChips } from './RoiChips'

const targets: RoiTarget[] = emptyTargets().map((x, i) =>
  i === 0 ? { ...x, name: '送電塔 A', lat: 36.2, lon: 137.6 } : i === 1 ? { ...x, name: '橋', lat: 36.3, lon: 137.7 } : i === 2 ? { ...x, name: '未配置' } : x,
)

const setup = (activeId: string | null) => {
  const p = { targets, activeId, onStart: vi.fn(), onStop: vi.fn(), dict: t('ja') }
  render(<RoiChips {...p} />)
  return p
}

describe('RoiChips', () => {
  it('renders only set presets, the active one on', () => {
    setup('roi_1')
    expect(screen.getByText('ROI')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '送電塔 A' })).toHaveClass('chip', 'on')
    expect(screen.getByRole('button', { name: '橋' })).not.toHaveClass('on')
    expect(screen.queryByRole('button', { name: '未配置' })).toBeNull()
    expect(document.querySelectorAll('button.chip')).toHaveLength(3)
  })

  it('the active chip stops, another starts, the stop chip stops', () => {
    const p = setup('roi_1')
    fireEvent.click(screen.getByRole('button', { name: '送電塔 A' }))
    expect(p.onStop).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '橋' }))
    expect(p.onStart).toHaveBeenCalledWith('roi_2')
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(p.onStop).toHaveBeenCalledTimes(2)
  })
})
