import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { ElevationSheet } from './ElevationSheet'
import { appendWaypoint, emptyDraft } from './model'

const draft = appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.11, 139.1)

describe('ElevationSheet', () => {
  it('opens from the map button, plots one point per item and selects from the chart', () => {
    const onSelect = vi.fn()
    render(<ElevationSheet draft={draft} selected={new Set([2])} terrainTiles={null} dict={t('ja')} onSelect={onSelect} />)
    expect(screen.queryByRole('region', { name: '標高プロファイル' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '標高プロファイル' }))
    const sheet = screen.getByRole('region', { name: '標高プロファイル' })
    expect(sheet).toHaveTextContent('地形データなし')
    const pts = sheet.querySelectorAll('.rg-elev-pt')
    expect(pts).toHaveLength(2)
    expect(pts[1]!.className).toContain('sel')
    expect(pts[1]!.textContent).toMatch(/#2 .*50 m/)
    fireEvent.click(pts[0]!, { ctrlKey: true })
    expect(onSelect).toHaveBeenCalledWith(1, true, false)
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('region', { name: '標高プロファイル' })).not.toBeInTheDocument()
  })
  it('shows a hint instead of a chart for an empty mission', () => {
    render(<ElevationSheet draft={emptyDraft()} selected={new Set()} terrainTiles={null} dict={t('ja')} onSelect={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '標高プロファイル' }))
    expect(screen.getByRole('region', { name: '標高プロファイル' })).toHaveTextContent('ウェイポイントを追加すると表示されます')
  })
})
