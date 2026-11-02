import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { EMPTY_CHANGES } from './changes'
import { ParamsTab } from './ParamsTab'
import type { ParamRow } from './search'

const bitmask: ParamRow = { name: 'LOG_BITMASK', value: 5, index: 1, ptype: 6, meta: { n: 'Log bitmask', d: '', b: { '0': 'Fast Attitude', '1': 'Medium Attitude', '2': 'GPS' } } }
const plain: ParamRow = { name: 'FENCE_ALT_MAX', value: 100, index: 2, ptype: 9, meta: { n: 'Fence', d: '' } }

describe('ParamsTab bitmask rows', () => {
  it('a_bitmask_parameter_opens_the_bit_editor_and_applies_its_value', () => {
    const onChange = vi.fn()
    render(<ParamsTab rows={[bitmask, plain]} total={2} progress={null} query="" changes={EMPTY_CHANGES} busy={false} dict={t('ja')} onQuery={() => {}} onRefresh={() => {}} onChange={onChange} />)
    expect(screen.getAllByRole('button', { name: 'ビットを選んで設定' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'ビットを選んで設定' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Medium Attitude/ }))
    fireEvent.click(screen.getByRole('button', { name: '適用' }))
    expect(onChange).toHaveBeenCalledWith('LOG_BITMASK', 7)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
