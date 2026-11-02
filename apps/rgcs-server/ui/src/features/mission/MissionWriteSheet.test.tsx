// 「ミッション書込」 from the ops panel: a click selects a saved mission; writing needs the
// footer button and then an in-app confirm that names the mission and the vehicle.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MissionSummaryRow } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { MissionWriteSheet } from './MissionWriteSheet'

const rows: MissionSummaryRow[] = [
  { id: 7, name: 'Survey A', sysid: null, item_count: 13, updated_at: new Date(2026, 9, 23, 23, 36, 24).getTime() },
  { id: 9, name: 'Patrol', sysid: 4, item_count: 5, updated_at: new Date(2026, 9, 24, 8, 5, 0).getTime() },
]

async function setup() {
  const onWrite = vi.fn()
  const onClose = vi.fn()
  await act(async () => {
    render(<MissionWriteSheet vehicleName="UAV-04" dict={t('ja')} onWrite={onWrite} onClose={onClose} load={async () => rows} />)
  })
  return { onWrite, onClose }
}
const sheet = () => screen.getByRole('dialog', { name: 'ミッション書込' })
const writeBtn = () => within(sheet()).getByRole('button', { name: 'UAV-04 に書き込む' })

describe('MissionWriteSheet', () => {
  it('a_click_selects_a_row_and_writes_nothing', async () => {
    const { onWrite } = await setup()
    expect(writeBtn()).toBeDisabled()
    fireEvent.click(within(sheet()).getByText('Survey A'))
    expect(onWrite).not.toHaveBeenCalled()
    expect(within(sheet()).getByRole('option', { name: /Survey A/ })).toHaveAttribute('aria-selected', 'true')
    expect(writeBtn()).toBeEnabled()
  })

  it('dates_use_the_app_format', async () => {
    await setup()
    expect(within(sheet()).getByText(/2026\/10\/23 23:36/)).toBeInTheDocument()
  })

  it('the_write_asks_in_app_naming_mission_and_vehicle_then_cancel_or_write', async () => {
    const { onWrite } = await setup()
    fireEvent.click(within(sheet()).getByText('Patrol'))
    fireEvent.click(writeBtn())
    const confirm = screen.getByRole('alertdialog', { name: 'ミッションを書き込みますか?' })
    expect(confirm).toHaveTextContent('Patrol')
    expect(confirm).toHaveTextContent('UAV-04')
    fireEvent.click(within(confirm).getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onWrite).not.toHaveBeenCalled()
    fireEvent.click(writeBtn())
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '書き込む' }))
    expect(onWrite).toHaveBeenCalledWith(rows[1])
  })
})
