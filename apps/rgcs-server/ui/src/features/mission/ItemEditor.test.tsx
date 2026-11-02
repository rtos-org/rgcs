import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { ItemEditor } from './ItemEditor'
import { appendWaypoint, emptyDraft } from './model'

describe('ItemEditor', () => {
  it('editor_shows_fields_of_the_selected_command_with_unused_tags', () => {
    const d = appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2)
    const onChange = vi.fn()
    const onCommand = vi.fn()
    render(<ItemEditor item={d.items[1]!} seq={2} kind="copter" dict={t('ja')} onChange={onChange} onCommand={onCommand} />)
    const sel = screen.getByLabelText('コマンド') as HTMLSelectElement
    expect(sel.value).toBe('WAYPOINT')
    expect(screen.getByText('MAV_CMD_NAV_WAYPOINT')).toBeInTheDocument()
    const accept = screen.getByLabelText('到達半径') as HTMLInputElement
    expect(accept.disabled).toBe(true)
    expect(screen.getAllByText('未使用')).toHaveLength(2)
    const delay = screen.getByLabelText('待機時間') as HTMLInputElement
    expect(delay.disabled).toBe(false)
    fireEvent.change(delay, { target: { value: '5' } })
    expect(onChange).toHaveBeenCalledWith(2, { params: [5, 0, 0, 0] })
    fireEvent.change(screen.getByLabelText('高度', { exact: true }), { target: { value: '80' } })
    expect(onChange).toHaveBeenLastCalledWith(2, { alt: 80 })
    fireEvent.change(screen.getByLabelText('基準'), { target: { value: 'abs' } })
    expect(onChange).toHaveBeenLastCalledWith(2, { frame: 'abs' })
    fireEvent.change(sel, { target: { value: 'LOITER_TIME' } })
    expect(onCommand).toHaveBeenCalledWith(2, 'LOITER_TIME')
  })

  it('non_positional_commands_hide_the_coordinates', () => {
    const d = appendWaypoint(emptyDraft(), 36.1, 139.1)
    const item = { ...d.items[0]!, command: 178, params: [1, 8, -1, 0] as [number, number, number, number], lat: 0, lon: 0, alt: 0 }
    render(<ItemEditor item={item} seq={1} kind="copter" dict={t('ja')} onChange={() => {}} onCommand={() => {}} />)
    expect(screen.queryByLabelText('緯度')).not.toBeInTheDocument()
    const speedType = screen.getByLabelText('速度種別') as HTMLSelectElement
    expect(speedType.value).toBe('1')
  })
})
