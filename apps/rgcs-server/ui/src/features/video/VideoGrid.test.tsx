import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VehicleState, VideoSourceStatus } from '../../shared/api/types'
import { t } from '../../shared/i18n'

const players: string[] = []
vi.mock('../../shared/video/whep', () => ({
  WhepPlayer: class {
    constructor(_video: HTMLVideoElement, url: string) {
      players.push(url)
    }
    start() {}
    stop() {}
  },
}))

const { VideoGrid } = await import('./VideoGrid')
const vehicle = (sysid: number, over: Partial<VehicleState> = {}): VehicleState => ({
  sysid, name: `UAV-0${sysid}`, kind: 'copter', mode: 'LOITER', armed: true, lat: 36, lon: 139, alt_rel: 81.6, alt_msl: 0, hdg: 0,
  ground_speed: 7.25, climb: 0, battery: { pct: 64, volt: 22.1, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0, ...over,
})
const live: VideoSourceStatus = { mode: 'auto', source: 'mt11', scanning: false, probe_ok: true, whep_path: 'mt11' }

describe('VideoGrid', () => {
  beforeEach(() => {
    players.length = 0
  })
  const props = (over = {}) => ({
    vehicles: [vehicle(1), vehicle(2, { kind: 'rover' as const, warn: true })],
    videoSources: new Map([[1, live]]),
    recording: new Map([[1, 'recording' as const]]),
    selected: 2,
    dict: t('ja'),
    onSelect: vi.fn(),
    onMaximize: vi.fn(),
    ...over,
  })

  it('shows one tile per vehicle with name, mode and alt / speed / battery; a tile without video says so', () => {
    render(<VideoGrid {...props()} />)
    const tiles = screen.getAllByTestId('vtile')
    expect(tiles).toHaveLength(2)
    expect(within(tiles[0]!).getByText('UAV-01')).toBeInTheDocument()
    expect(within(tiles[0]!).getByText('LOITER')).toBeInTheDocument()
    expect(tiles[0]).toHaveTextContent('82 m')
    expect(tiles[0]).toHaveTextContent('7.3 m/s')
    expect(tiles[0]).toHaveTextContent('64%')
    expect(tiles[0]).toHaveTextContent('AUTO REC')
    expect(within(tiles[0]!).queryByText('映像未接続')).toBeNull()
    expect(within(tiles[1]!).getByText('映像未接続')).toBeInTheDocument()
    expect(players).toEqual(['/api/vehicles/1/video/whep'])
  })

  it('marks the selected tile, selects on click and maximizes without a second select', () => {
    const p = props()
    render(<VideoGrid {...p} />)
    const tiles = screen.getAllByTestId('vtile')
    expect(tiles[1]).toHaveClass('vtile', 'sel')
    expect(tiles[0]).not.toHaveClass('sel')
    fireEvent.click(tiles[0]!)
    expect(p.onSelect).toHaveBeenCalledWith(1)
    fireEvent.click(within(tiles[1]!).getByRole('button', { name: '最大化' }))
    expect(p.onMaximize).toHaveBeenCalledWith(2)
    expect(p.onSelect).toHaveBeenCalledTimes(1)
  })
})
