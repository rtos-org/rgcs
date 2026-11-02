import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const players: { url: string; opts: { onState?: (s: unknown) => void } }[] = []
vi.mock('../shared/video/whep', () => ({
  WhepPlayer: class {
    url: string
    opts: { onState?: (s: unknown) => void }
    constructor(_v: HTMLVideoElement, url: string, opts: { onState?: (s: unknown) => void }) {
      this.url = url
      this.opts = opts
      players.push(this)
    }
    start() {}
    stop() {}
    getState() {
      return { phase: 'idle', attempt: 0, holdFrame: false, lastError: null }
    }
  },
}))
vi.mock('../features/map/MapView', () => ({ MapView: (p: { follow: number | null }) => <div data-testid="map" data-follow={p.follow ?? ''} /> }))

const { PresentApp } = await import('./PresentApp')

const config = { sysid: 1, vehicle_name: 'UAV-01', logo: true, map_tile_url: 'https://t/{z}/{x}/{y}.png', map_attribution: 'x', whep_path: 'mt11' }
const vehicle = { sysid: 1, name: 'UAV-01', lat: 35.479883, lon: 138.47829, hdg: 10, alt_rel: 40, mode: 'AUTO', armed: true, link: 'ok' }

function envelope(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function stub(configStatus: number, vehicleResponder: () => Response) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    if (url.startsWith('/present/config')) {
      return configStatus === 200 ? envelope(200, { success: true, data: config }) : envelope(401, { success: false, error: { code: 'invalid_token', message: 'x' } })
    }
    if (url.startsWith('/present/vehicle')) return vehicleResponder()
    return envelope(404, { success: false, error: { code: 'not_found', message: url } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('PresentApp', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    players.length = 0
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('invalid token renders the notice and stops polling', async () => {
    const fetchMock = stub(401, () => envelope(200, { success: true, data: vehicle }))
    render(<PresentApp token="deadbeef" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('無効なリンクです')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const calls = fetchMock.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(fetchMock.mock.calls.length).toBe(calls)
    expect(players).toHaveLength(0)
  })

  it('a server error on the config keeps the blank screen and retries until it loads', async () => {
    let configCalls = 0
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.startsWith('/present/config')) {
        configCalls += 1
        return configCalls === 1 ? envelope(503, { success: false, error: { code: 'unavailable', message: 'x' } }) : envelope(200, { success: true, data: config })
      }
      return envelope(200, { success: true, data: vehicle })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<PresentApp token="deadbeef" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.queryByText('無効なリンクです')).not.toBeInTheDocument()
    expect(document.querySelector('video')).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100)
    })
    expect(configCalls).toBe(2)
    expect(document.querySelector('video.present-video')).not.toBeNull()
  })

  it('a 401 from the vehicle poll means the link was revoked: notice shown, polling and video stop', async () => {
    let revoked = false
    const fetchMock = stub(200, () => (revoked ? envelope(401, { success: false, error: { code: 'invalid_token', message: 'x' } }) : envelope(200, { success: true, data: vehicle })))
    render(<PresentApp token="deadbeef" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(document.querySelector('video.present-video')).not.toBeNull()
    revoked = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(screen.getByText('無効なリンクです')).toBeInTheDocument()
    expect(document.querySelector('video')).toBeNull()
    const calls = fetchMock.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it('ready renders video, logo and mini-map and polls the vehicle at 2 Hz', async () => {
    const fetchMock = stub(200, () => envelope(200, { success: true, data: vehicle }))
    render(<PresentApp token="abc" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(players).toHaveLength(1)
    expect(players[0]!.url).toBe('/present/whep?t=abc')
    expect(screen.getByRole('img', { name: 'logo' })).toHaveAttribute('src', '/present/logo?t=abc')
    expect(screen.getByTestId('map')).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    const vehicleCalls = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/present/vehicle')).length
    expect(vehicleCalls).toBeGreaterThanOrEqual(4)
    expect(vehicleCalls).toBeLessThanOrEqual(6)
    expect(screen.getByTestId('map')).toHaveAttribute('data-follow', '1')
  })

  it('vehicle fetch failures keep the last position and never show a dialog', async () => {
    let fail = false
    stub(200, () => (fail ? envelope(503, { success: false, error: { code: 'x', message: 'x' } }) : envelope(200, { success: true, data: vehicle })))
    render(<PresentApp token="abc" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(screen.getByTestId('map')).toHaveAttribute('data-follow', '1')
    fail = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(screen.getByTestId('map')).toHaveAttribute('data-follow', '1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the reconnecting badge after 1 s in reconnecting and no sooner', async () => {
    stub(200, () => envelope(200, { success: true, data: vehicle }))
    render(<PresentApp token="abc" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => players[0]!.opts.onState?.({ phase: 'reconnecting', attempt: 1, holdFrame: true, lastError: 'x' }))
    expect(screen.queryByText('再接続中')).not.toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.getByText('再接続中')).toBeInTheDocument()
  })
})
