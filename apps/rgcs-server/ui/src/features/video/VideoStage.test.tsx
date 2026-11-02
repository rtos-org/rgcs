import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CameraSnapshot, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'

vi.mock('../../shared/video/whep', () => ({
  WhepPlayer: class {
    start() {}
    stop() {}
  },
}))

const { VideoStage } = await import('./VideoStage')
const vehicle = (sysid: number): VehicleState => ({
  sysid, name: `UAV-0${sysid}`, kind: 'copter', mode: 'LOITER', armed: true, lat: 36, lon: 139, alt_rel: 50, alt_msl: 0, hdg: 0,
  ground_speed: 5, climb: 0, battery: { pct: 64, volt: 22.1, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
})
const cam: CameraSnapshot = {
  sysid: 2,
  caps: { kind: 'none', gimbal: null, zoom: null, focus: false, photo: false, record: false, video_modes: [], hfov_deg: null, roi: 'none', thermal: null, ai_tracking: null, encoding_presets: [], storage_info: false, clock_sync: false },
  state: { connected: true, last_error: null, firmware: null, recording: 'recording', zoom: 1, zoom_max: 1, video_mode: null, gimbal: null, gimbal_mode: null, stream: null, encoding: null, thermal: null, track: null, candidates: [], ai_ack: null, storage: null, clock: null },
}

const setup = (maximized: number | null) => {
  const p = {
    vehicles: [vehicle(1), vehicle(2)],
    cameras: new Map([[2, cam]]),
    videoSources: new Map(),
    pending: new Set<number>(),
    selected: 1,
    maximized,
    dict: t('ja'),
    onSelect: vi.fn(),
    onMaximize: vi.fn(),
    onRestore: vi.fn(),
    onCommand: vi.fn(),
    onSettings: vi.fn(),
    miniMap: <div data-testid="mini-map" />,
  }
  render(<VideoStage {...p} />)
  return p
}

describe('VideoStage', () => {
  it('shows the grid over the aurora with each vehicle’s recording state', () => {
    const p = setup(null)
    expect(screen.getAllByTestId('vtile')).toHaveLength(2)
    expect(screen.getAllByTestId('vtile')[1]).toHaveTextContent('AUTO REC')
    expect(screen.queryByTestId('mini-map')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: '最大化' })[1]!)
    expect(p.onMaximize).toHaveBeenCalledWith(2)
  })

  it('shows the cockpit for the maximized vehicle with the mini map; restore goes back', () => {
    const p = setup(2)
    expect(screen.queryAllByTestId('vtile')).toHaveLength(0)
    expect(screen.getByText('UAV-02')).toBeInTheDocument()
    expect(screen.getByTestId('mini-map')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    expect(p.onRestore).toHaveBeenCalled()
  })

  it('falls back to the grid when the maximized vehicle is gone', () => {
    setup(9)
    expect(screen.getAllByTestId('vtile')).toHaveLength(2)
  })
})
