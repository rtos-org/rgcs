import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthStore } from '../features/auth/store'
import { App } from './App'

vi.mock('../features/map/MapView', () => ({ MapView: () => <div data-testid="map" /> }))

class FakeSocket {
  static instances: FakeSocket[] = []
  static get last(): FakeSocket | null {
    return FakeSocket.instances.at(-1) ?? null
  }
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((ev: MessageEvent<string>) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onerror: (() => void) | null = null
  constructor() {
    FakeSocket.instances.push(this)
  }
  send() {}
  close() {}
}

const me = { username: 'admin', role: 'admin', dev_mode: true, hostname: 'rgcs' }

function envelope(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** `/api/auth/me` answers from the queue in order; the last answer repeats. */
function stubMe(answers: number[]) {
  const queue = [...answers]
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    if (url === '/api/auth/me') {
      const status = queue.length > 1 ? queue.shift()! : queue[0]!
      return status === 200
        ? envelope(200, { success: true, data: me })
        : envelope(401, { success: false, error: { code: 'unauthorized', message: 'sign in first' } })
    }
    if (url === '/api/health') {
      return envelope(200, { success: true, data: { status: 'ok', hostname: 'rgcs', version: '0', dev_mode: true } })
    }
    return envelope(404, { success: false, error: { code: 'not_found', message: url } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('App auth gate', () => {
  beforeEach(() => {
    FakeSocket.instances = []
    vi.stubGlobal('WebSocket', FakeSocket)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('renders nothing until the session is resolved', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const { container } = render(<App store={new AuthStore()} />)
    expect(container).toBeEmptyDOMElement()
    expect(FakeSocket.instances).toHaveLength(0)
  })

  it('renders the login screen when there is no session', async () => {
    stubMe([401])
    render(<App store={new AuthStore()} />)
    expect(await screen.findByRole('button', { name: 'ログイン' })).toBeInTheDocument()
    expect(FakeSocket.instances).toHaveLength(0)
  })

  it('renders the shell and connects the WebSocket when signed in', async () => {
    stubMe([200])
    render(<App store={new AuthStore()} />)
    expect(await screen.findByText('RGCS')).toBeInTheDocument()
    expect(FakeSocket.instances).toHaveLength(1)
    const s = FakeSocket.last!
    await act(async () => {
      s.readyState = 1
      s.onopen?.()
      s.onmessage?.({ data: JSON.stringify({ t: 'snapshot', vehicles: [], cameras: [], video_sources: [] }) } as MessageEvent<string>)
    })
    expect(screen.getByTestId('link')).toHaveAttribute('title', 'サーバー接続')
  })

  it('keeps the shell and reconnects when the socket drops but the server is merely unreachable', async () => {
    const fetchMock = stubMe([200])
    render(<App store={new AuthStore()} />)
    await screen.findByText('RGCS')
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))
    await act(async () => {
      FakeSocket.last!.onclose?.({ code: 1006 } as CloseEvent)
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600)) // first reconnect backoff is 500 ms
    })
    expect(screen.getByText('RGCS')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ログイン' })).not.toBeInTheDocument()
    expect(FakeSocket.instances.length).toBeGreaterThanOrEqual(2)
  })

  it('drops to the login screen when the socket closes because the session expired', async () => {
    stubMe([200, 401])
    render(<App store={new AuthStore()} />)
    await screen.findByText('RGCS')
    const s = FakeSocket.last!
    await act(async () => {
      s.onclose?.({ code: 4401 } as CloseEvent)
    })
    expect(await screen.findByRole('button', { name: 'ログイン' })).toBeInTheDocument()
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
  })
})

describe('Shell AI panel', () => {
  beforeEach(() => {
    FakeSocket.instances = []
    vi.stubGlobal('WebSocket', FakeSocket)
  })
  afterEach(() => vi.unstubAllGlobals())

  const vehicle = {
    sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'LOITER', armed: false, lat: 35, lon: 139, alt_rel: 0, alt_msl: 0, hdg: null,
    ground_speed: 0, climb: 0, battery: { pct: 50, volt: 22, current: null }, link: 'ok', last_rx_ms: 0,
    gps: { fix: 3, sats: 10, hdop: 1 }, warn: false, unread: 0,
  }

  async function signedInWithVehicle() {
    stubMe([200])
    const { container } = render(<App store={new AuthStore()} />)
    await screen.findByText('RGCS')
    await act(async () => {
      FakeSocket.last!.readyState = 1
      FakeSocket.last!.onopen?.()
      FakeSocket.last!.onmessage?.({ data: JSON.stringify({ t: 'snapshot', vehicles: [vehicle], cameras: [], video_sources: [] }) } as MessageEvent<string>)
    })
    fireEvent.click(await screen.findByText('UAV-01'))
    await waitFor(() => expect(container.querySelector('aside.detail')).not.toBeNull())
    return container
  }

  it('the AI nav button toggles the AI panel in place of the detail panel', async () => {
    const container = await signedInWithVehicle()
    const nav = screen.getByRole('button', { name: 'AIチャット' })
    fireEvent.click(nav)
    expect(container.querySelector('aside.ai')).not.toBeNull()
    expect(container.querySelector('aside.detail')).toBeNull()
    expect(container.querySelector('main.stage')).not.toHaveClass('noright')
    fireEvent.click(nav)
    expect(container.querySelector('aside.ai')).toBeNull()
    expect(container.querySelector('aside.detail')).not.toBeNull()
  })

  it('the AI panel close button returns to the detail panel', async () => {
    const container = await signedInWithVehicle()
    fireEvent.click(screen.getByRole('button', { name: 'AIチャット' }))
    const ai = container.querySelector('aside.ai') as HTMLElement
    fireEvent.click(ai.querySelector('.panel-h button[aria-label="閉じる"]')!)
    expect(container.querySelector('aside.ai')).toBeNull()
    expect(container.querySelector('aside.detail')).not.toBeNull()
  })
  it('a guard_alert frame shows the banner and highlights the vehicle row', async () => {
    const container = await signedInWithVehicle()
    const alert = {
      id: 'g-1', sysid: 1, vehicle_name: 'UAV-01', event: 'toilet_bowl', phase: 'alerting', level: 'l1', confidence: 1,
      signs: { a: true, b: true, c: false, turn_deg: 300, radius_m: 2, compass_var: null }, deadline_ms: null, action_mode: null, taken_over_by: null, vehicle_mode: 'LOITER',
      rc_stale: false, kp_raised: false, sound: true, text: 'UAV-01 トイレットボウルの兆候 — 手動で引き継いでください', ts: Date.now(),
    }
    await act(async () => {
      FakeSocket.last!.onmessage?.({ data: JSON.stringify({ t: 'guard_alert', alert }) } as MessageEvent<string>)
    })
    const banner = container.querySelector('div.guard-banner.danger') as HTMLElement
    expect(banner).not.toBeNull()
    expect(banner).toHaveTextContent('UAV-01 旋回が不安定です (トイレットボウル) — 手動で引き継いでください')
    const row = container.querySelector('.vrow') as HTMLElement
    expect(row).toHaveClass('guard')
    expect(row.querySelector('[data-testid="dot"]')).toHaveClass('warn')
    await act(async () => {
      FakeSocket.last!.onmessage?.({ data: JSON.stringify({ t: 'guard_alert', alert: { ...alert, phase: 'cleared', sound: false } }) } as MessageEvent<string>)
    })
    expect(container.querySelector('div.guard-banner')).toBeNull()
  })
})
