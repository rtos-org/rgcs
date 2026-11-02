import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { FencePanel, PlanTabs, RallyPanel } from './PlanPanels'
import { readPlanTab } from './planTab'

const dict = t('ja')
const square = { kind: 'polygon' as const, inclusion: true, vertices: [{ lat: 36, lon: 137 }, { lat: 36, lon: 137.01 }, { lat: 36.01, lon: 137.01 }] }
const line = { kind: 'polygon' as const, inclusion: false, vertices: [{ lat: 36, lon: 137 }, { lat: 36, lon: 137.01 }] }
const circle = { kind: 'circle' as const, inclusion: true, center: { lat: 36, lon: 137 }, radius: 120 }

describe('PlanTabs', () => {
  it('switches Mission / Fence / Rally and remembers the choice', () => {
    const onChange = vi.fn()
    render(<PlanTabs tab="mission" dict={dict} onChange={onChange} />)
    const group = screen.getByRole('group', { name: '計画の種類' })
    fireEvent.click(within(group).getByRole('button', { name: 'フェンス' }))
    expect(onChange).toHaveBeenCalledWith('fence')
    expect(readPlanTab()).toBe('fence')
  })
})

describe('FencePanel', () => {
  const base = { zones: [square, line, circle], armed: null, drawing: null, sysid: 1, busy: false, status: null, dict, onArm: vi.fn(), onDone: vi.fn(), onRadius: vi.fn(), onInclusion: vi.fn(), onRemove: vi.fn(), onWrite: vi.fn(), onRead: vi.fn(), fenceParams: null, onAltMax: vi.fn() }
  it('lists the zones with their kind, size and problems', () => {
    render(<FencePanel {...base} />)
    const rows = screen.getAllByTestId('fence-row')
    expect(rows.map((r) => r.querySelector('.fence-title')?.textContent)).toEqual(['包含ポリゴン · 3 点', '除外ポリゴン · 2 点', '包含円'])
    expect(rows[1]).toHaveTextContent('頂点が 3 点以上必要です')
    fireEvent.change(within(rows[2]!).getByLabelText('半径'), { target: { value: '' } })
    expect(base.onRadius).not.toHaveBeenCalled()
    fireEvent.change(within(rows[2]!).getByLabelText('半径'), { target: { value: '250' } })
    expect(base.onRadius).toHaveBeenCalledWith(2, 250)
    fireEvent.click(within(rows[0]!).getByRole('button', { name: '除外' }))
    expect(base.onInclusion).toHaveBeenCalledWith(0, false)
    fireEvent.click(within(rows[0]!).getByRole('button', { name: '削除' }))
    expect(base.onRemove).toHaveBeenCalledWith(0)
  })
  it('arms a new zone and finishes a polygon being drawn', () => {
    const { rerender } = render(<FencePanel {...base} />)
    fireEvent.click(screen.getByRole('button', { name: '除外円' }))
    expect(base.onArm).toHaveBeenCalledWith({ kind: 'circle', inclusion: false })
    rerender(<FencePanel {...base} armed={{ kind: 'polygon', inclusion: true }} drawing={0} />)
    expect(screen.getByText(/3 点以上で「完了」/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '完了' }))
    expect(base.onDone).toHaveBeenCalled()
  })
})

describe('RallyPanel', () => {
  it('lists the points with editable altitude, delete, write and read', () => {
    const p = { points: [{ lat: 36.25, lon: 137.63, alt: 60 }], sysid: 1, busy: false, status: null, dict, onAlt: vi.fn(), onRemove: vi.fn(), onWrite: vi.fn(), onRead: vi.fn() }
    render(<RallyPanel {...p} />)
    const row = screen.getByTestId('rally-row')
    expect(row).toHaveTextContent('R1')
    fireEvent.change(within(row).getByLabelText('高度'), { target: { value: '' } })
    expect(p.onAlt).not.toHaveBeenCalled()
    fireEvent.change(within(row).getByLabelText('高度'), { target: { value: '80' } })
    expect(p.onAlt).toHaveBeenCalledWith(0, 80)
    fireEvent.click(within(row).getByRole('button', { name: '削除' }))
    expect(p.onRemove).toHaveBeenCalledWith(0)
  })
})
