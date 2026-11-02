import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { t } from '../../shared/i18n'
import { CompareTable, type CompareLine } from './CompareTable'

const dict = t('ja')
const line = (key: string, over: Partial<CompareLine>): CompareLine => ({ key, color: '#9cc9ff', name: key, vehicles: [], distanceM: 1000, durationS: 600, batteryPct: null, batteryWarn: false, ...over })

describe('CompareTable', () => {
  it('distance_is_prominent_and_battery_is_marked_as_an_estimate_and_warns_over_70', () => {
    const lines = [
      line('Alpha', { vehicles: ['UAV-01', 'UAV-03'], distanceM: 2400, durationS: 754, batteryPct: 42, batteryWarn: false }),
      line('Beta', { vehicles: ['UAV-02'], distanceM: 800, batteryPct: 85, batteryWarn: true }),
      line('Gamma', {}),
    ]
    render(<CompareTable lines={lines} dict={dict} />)
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads).toEqual(['プラン', '機体', '距離', '時間 (目安)', 'バッテリー (目安)'])
    const rows = screen.getAllByRole('row').slice(1)
    const cells = (i: number) => within(rows[i]!).getAllByRole('cell')
    expect(cells(0).map((c) => c.textContent)).toEqual(['Alpha', 'UAV-01, UAV-03', '2.40 km', '12:34', '42%'])
    expect(cells(0)[2]!.querySelector('.big')?.textContent).toBe('2.40 km')
    expect(cells(0)[4]!.classList.contains('warn')).toBe(false)
    expect(cells(1)[4]!.classList.contains('warn')).toBe(true)
    expect(cells(2).map((c) => c.textContent)).toEqual(['Gamma', '—', '1.00 km', '10:00', '—'])
    expect(rows[0]!.querySelector<HTMLElement>('.plans-dot')?.style.background).toBe('rgb(156, 201, 255)')
    // writing lives on the assignment board now (spec 2026-10-31 §9)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
