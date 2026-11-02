import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { FenceSidebar, RallySidebar } from './PlanSidebar'

const dict = t('ja')
const square = { kind: 'polygon' as const, inclusion: true, vertices: [{ lat: 36, lon: 137 }, { lat: 36, lon: 137.01 }, { lat: 36.01, lon: 137.01 }] }
const circle = { kind: 'circle' as const, inclusion: false, center: { lat: 36, lon: 137 }, radius: 120 }
const io = () => ({ sysid: 1, busy: false, status: null, dict, onWrite: vi.fn(), onRead: vi.fn(), onSaveFile: vi.fn(), onLoadFile: vi.fn() })

describe('FenceSidebar (right panel of the Fence tab)', () => {
  it('sums the zones up', () => {
    render(<FenceSidebar {...io()} zones={[square, circle]} fenceParams={null} onAltMax={vi.fn()} />)
    const panel = screen.getByRole('complementary', { name: 'フェンス設定' })
    expect(within(panel).getByTestId('fence-summary')).toHaveTextContent('包含1')
    expect(within(panel).getByTestId('fence-summary')).toHaveTextContent('除外1')
  })

  it("shows the vehicle's FENCE_ALT_MAX and sets a new one", () => {
    const onAltMax = vi.fn()
    const { rerender } = render(<FenceSidebar {...io()} zones={[]} fenceParams={{ enabled: true, alt_max: 120, alt_max_on: true, zones_on: true }} onAltMax={onAltMax} />)
    const box = screen.getByTestId('fence-alt-max')
    expect((within(box).getByLabelText('高度上限 (FENCE_ALT_MAX)') as HTMLInputElement).value).toBe('120')
    fireEvent.change(within(box).getByLabelText('高度上限 (FENCE_ALT_MAX)'), { target: { value: '150' } })
    fireEvent.click(within(box).getByRole('button', { name: '機体に書込' }))
    expect(onAltMax).toHaveBeenCalledWith(150)
    rerender(<FenceSidebar {...io()} zones={[]} fenceParams={{ enabled: false, alt_max: 120, alt_max_on: false, zones_on: false }} onAltMax={onAltMax} />)
    expect(screen.getByTestId('fence-alt-max')).toHaveTextContent('FENCE_TYPE で無効')
    expect(screen.getByTestId('fence-alt-max')).toHaveTextContent('FENCE_ENABLE = 0')
  })

  it('writes and reads the vehicle, needing one; saves and loads files', () => {
    const p = io()
    const { rerender } = render(<FenceSidebar {...p} zones={[square]} status={{ ok: true, text: '書き込みました (読み戻して一致)' }} fenceParams={null} onAltMax={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'フェンスを機体に書込' }))
    fireEvent.click(screen.getByRole('button', { name: 'フェンスを機体から読込' }))
    expect([p.onWrite, p.onRead].map((f) => f.mock.calls.length)).toEqual([1, 1])
    expect(screen.getByText('書き込みました (読み戻して一致)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '書き出し (.waypoints)' }))
    expect(p.onSaveFile).toHaveBeenCalled()
    const file = new File(['QGC WPL 110\n'], 'f.waypoints')
    fireEvent.change(screen.getByLabelText('ファイルを読み込む'), { target: { files: [file] } })
    expect(p.onLoadFile).toHaveBeenCalledWith(file)
    rerender(<FenceSidebar {...p} sysid={null} zones={[]} fenceParams={null} onAltMax={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'フェンスを機体に書込' })).toBeDisabled()
    // nothing to save
    expect(screen.getByRole('button', { name: '書き出し (.waypoints)' })).toBeDisabled()
  })
})

describe('RallySidebar (right panel of the Rally tab)', () => {
  it('counts the points, writes / reads and saves / loads files', () => {
    const p = io()
    render(<RallySidebar {...p} points={[{ lat: 36.25, lon: 137.63, alt: 60 }]} />)
    const panel = screen.getByRole('complementary', { name: 'ラリーポイント設定' })
    expect(within(panel).getByTestId('rally-summary')).toHaveTextContent('1')
    fireEvent.click(screen.getByRole('button', { name: 'ラリーを機体に書込' }))
    expect(p.onWrite).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '書き出し (.waypoints)' }))
    expect(p.onSaveFile).toHaveBeenCalled()
  })
})
