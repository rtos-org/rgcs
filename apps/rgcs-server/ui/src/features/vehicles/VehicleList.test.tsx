import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import type { VehicleState } from '../../shared/api/types'
import { VehicleList } from './VehicleList'

const mk = (sysid: number, name: string, mode: string): VehicleState => ({
  sysid,
  name,
  kind: 'copter',
  mode,
  armed: true,
  lat: 0,
  lon: 0,
  alt_rel: 82,
  alt_msl: 0,
  hdg: 0,
  ground_speed: 8.4,
  climb: 0,
  battery: { pct: 78, volt: 23, current: null },
  link: 'ok',
  last_rx_ms: 0,
  gps: { fix: 3, sats: 10, hdop: 1 },
  warn: false,
  unread: 0,
})

describe('VehicleList', () => {
  it('renders rows, filters and selects', () => {
    const onSelect = vi.fn()
    render(<VehicleList vehicles={[mk(1, 'UAV-01', 'AUTO'), mk(2, 'UAV-02', 'RTL')]} selected={1} dict={t('ja')} onSelect={onSelect} />)
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('UAV-01')
    expect(screen.getAllByText(/82 m/)).toHaveLength(2)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'rtl' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.click(screen.getByText('UAV-02'))
    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('shows the empty hint without vehicles', () => {
    render(<VehicleList vehicles={[]} selected={null} dict={t('en')} onSelect={() => {}} />)
    expect(screen.getByText('Vehicles appear here once they connect')).toBeInTheDocument()
  })
})

describe('VehicleList follow (double-click, memory: ops map)', () => {
  it('calls onFollow with the sysid on double-click', () => {
    const onSelect = vi.fn()
    const onFollow = vi.fn()
    render(<VehicleList vehicles={[mk(1, 'UAV-01', 'AUTO')]} selected={null} dict={t('ja')} onSelect={onSelect} onFollow={onFollow} following={null} />)
    fireEvent.doubleClick(screen.getByRole('option'))
    expect(onFollow).toHaveBeenCalledWith(1)
  })
  it('offers fleet pause / RTL when two or more vehicles have a link', () => {
    const onFleet = vi.fn()
    const { rerender } = render(<VehicleList vehicles={[mk(1, 'UAV-01', 'AUTO'), mk(2, 'UAV-02', 'RTL')]} selected={1} dict={t('ja')} onSelect={() => {}} onFleet={onFleet} />)
    fireEvent.click(screen.getByRole('button', { name: '全機 一時停止' }))
    expect(onFleet).toHaveBeenLastCalledWith({ cmd: 'pause' })
    fireEvent.click(screen.getByRole('button', { name: '全機 帰還' }))
    expect(onFleet).toHaveBeenLastCalledWith({ cmd: 'rtl' })
    rerender(<VehicleList vehicles={[mk(1, 'UAV-01', 'AUTO')]} selected={1} dict={t('ja')} onSelect={() => {}} onFleet={onFleet} />)
    expect(screen.queryByRole('button', { name: '全機 一時停止' })).toBeNull()
  })
  it('shows the unread alert count and can sort by alerts (remembered)', () => {
    localStorage.removeItem('rgcs.vehicleSort')
    const list = [mk(1, 'UAV-01', 'AUTO'), { ...mk(2, 'UAV-02', 'RTL'), unread: 3 }]
    render(<VehicleList vehicles={list} selected={1} dict={t('ja')} onSelect={() => {}} />)
    expect(screen.getAllByRole('option').map((o) => o.querySelector('.nm')?.textContent)).toEqual(['UAV-01', 'UAV-02'])
    expect(screen.getByLabelText('未読の警告 3')).toHaveTextContent('3')
    fireEvent.click(screen.getByRole('button', { name: '警告順' }))
    expect(screen.getAllByRole('option').map((o) => o.querySelector('.nm')?.textContent)).toEqual(['UAV-02', 'UAV-01'])
    expect(localStorage.getItem('rgcs.vehicleSort')).toBe('alerts')
  })
})
