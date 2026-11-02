import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MissionSummaryRow } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { MissionPicker } from './MissionPicker'

const dict = t('ja')
const rows: MissionSummaryRow[] = [
  { id: 1, name: 'North field', sysid: null, item_count: 4, updated_at: 0 },
  { id: 2, name: 'River', sysid: 2, item_count: 7, updated_at: 0 },
]
const load = () => Promise.resolve(rows)

async function show(onDelete?: (row: MissionSummaryRow) => Promise<boolean>) {
  const onPick = vi.fn()
  await act(async () => {
    render(<MissionPicker dict={dict} title={dict.mSaved} load={load} onPick={onPick} onClose={() => {}} onDelete={onDelete} />)
  })
  return onPick
}
const deleteButton = (name: string) => screen.getByRole('button', { name: dict.mDeleteNamed.replace('{name}', name) })

describe('MissionPicker', () => {
  it('without_on_delete_there_is_no_delete_button', async () => {
    await show()
    expect(screen.getByText('North field')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: dict.mDeleteNamed.replace('{name}', 'North field') })).toBeNull()
  })

  it('each_row_opens_from_its_own_button_with_the_delete_button_beside_it', async () => {
    const onPick = await show(() => Promise.resolve(true))
    const del = deleteButton('North field')
    expect(del.parentElement?.closest('button, [role="button"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^North field\s*4 項目/ }))
    expect(onPick).toHaveBeenCalledWith(rows[0])
  })

  it('delete_asks_in_the_sheet_and_cancel_keeps_the_plan', async () => {
    const onDelete = vi.fn(() => Promise.resolve(true))
    const onPick = await show(onDelete)
    fireEvent.click(deleteButton('North field'))
    expect(onPick).not.toHaveBeenCalled()
    const ask = screen.getByRole('alertdialog')
    expect(ask).toHaveTextContent(dict.mDeleteAsk.replace('{name}', 'North field'))
    fireEvent.click(within(ask).getByRole('button', { name: dict.cancel }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByText('North field')).toBeInTheDocument()
  })

  it('confirming_deletes_and_drops_the_row_only_when_it_worked', async () => {
    const onDelete = vi.fn((r: MissionSummaryRow) => Promise.resolve(r.id === 1))
    await show(onDelete)
    fireEvent.click(deleteButton('River'))
    await act(async () => {
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: dict.mDeleteYes }))
    })
    expect(onDelete).toHaveBeenCalledWith(rows[1])
    expect(screen.getByText('River')).toBeInTheDocument()
    fireEvent.click(deleteButton('North field'))
    await act(async () => {
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: dict.mDeleteYes }))
    })
    expect(screen.queryByText('North field')).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
