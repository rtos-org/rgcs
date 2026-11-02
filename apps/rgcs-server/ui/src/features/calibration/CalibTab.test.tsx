import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CalibRecord, CalibStatus, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { CalibTab } from './CalibTab'

const dict = t('ja')
const copter: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'STABILIZE', armed: false, lat: 36.25, lon: 137.63, alt_rel: 0, alt_msl: 0, hdg: 0,
  ground_speed: 0, climb: 0, battery: { pct: 90, volt: 24, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
}
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } })
const status = (over: Partial<CalibStatus>): CalibStatus => ({ kind: 'accel', phase: 'running', position: null, compass: [], rc: [], reboot: false, reason: null, ...over })

interface Call {
  readonly url: string
  readonly method: string
  readonly body: Record<string, unknown> | null
}

function setup(opts: { records?: CalibRecord[]; vehicle?: VehicleState; session?: CalibStatus } = {}) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ url, method, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null })
      if (url.includes('/params/pick')) return ok({ values: { FRAME_CLASS: 1 }, missing: [] })
      if (url.endsWith('/confirm')) return ok({ confirm_token: 'tok', expires_in: 30 })
      if (url.endsWith('/motor-test')) return ok({ ok: true, reason: null })
      if (url.endsWith('/calibration') && method === 'GET') return ok({ records: opts.records ?? [], session: null })
      const kind = (calls.at(-1)?.body?.kind as CalibStatus['kind'] | undefined) ?? 'accel'
      return ok(status({ kind, phase: 'done' }))
    }),
  )
  const view = render(<CalibTab sysid={1} vehicle={opts.vehicle ?? copter} session={opts.session} dict={dict} />)
  return { calls, view, posts: () => calls.filter((c) => c.method === 'POST') }
}

afterEach(() => vi.unstubAllGlobals())

describe('CalibTab', () => {
  it('shows one card per calibration with its last date', async () => {
    // a fixed "now" 9 days after the record: inside the 30-day freshness window on any run date
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 9, 10))
    try {
      setup({ records: [{ kind: 'compass', ok: true, at: Date.UTC(2026, 9, 1, 16), operator: 'op', detail: null }] })
      for (const label of ['加速度計', 'コンパス', '水平レベル', 'RC 校正', 'ESC 校正', 'モーターテスト']) {
        expect(screen.getByText(label)).toBeInTheDocument()
      }
      expect(await screen.findByText('校正済み · 2026/10/02')).toBeInTheDocument()
      expect(within(screen.getByTestId('calib-rc')).getByText('未実施')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a calibration older than 30 days reads as stale', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 10, 15))
    try {
      setup({ records: [{ kind: 'compass', ok: true, at: Date.UTC(2026, 9, 1, 16), operator: 'op', detail: null }] })
      expect(await within(screen.getByTestId('calib-compass')).findByText(dict.calStale)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a card opens with its instructions and starts only on 開始', async () => {
    const { posts } = setup()
    fireEvent.click(within(screen.getByTestId('calib-level')).getByRole('button', { name: '校正を開始' }))
    expect(screen.getByText(dict.calLevelHint)).toBeInTheDocument()
    expect(posts()).toEqual([])
    fireEvent.click(within(screen.getByTestId('calib-level')).getByRole('button', { name: '開始' }))
    await waitFor(() => expect(posts()[0]).toMatchObject({ url: '/api/vehicles/1/calibration', body: { kind: 'level' } }))
    expect(await within(screen.getByTestId('calib-level')).findByText(dict.calOk)).toBeInTheDocument()
  })

  it('the accelerometer card asks for the position the vehicle wants and confirms it', async () => {
    const { posts } = setup({ session: status({ phase: 'waiting', position: 2 }) })
    const card = screen.getByTestId('calib-accel')
    expect(within(card).getByText('左側を下')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'この姿勢で決定' }))
    await waitFor(() => expect(posts()[0]?.url).toBe('/api/vehicles/1/calibration/next'))
  })

  it('the compass card shows each compass and offers a reboot when done', () => {
    const progress = [{ id: 0, pct: 100, status: 4, fitness: 9 }, { id: 1, pct: 40, status: null, fitness: null }]
    const { view } = setup({ session: status({ kind: 'compass', compass: progress }) })
    const card = screen.getByTestId('calib-compass')
    expect(within(card).getByText('コンパス 1')).toBeInTheDocument()
    expect(within(card).getByText('40%')).toBeInTheDocument()
    view.rerender(<CalibTab sysid={1} vehicle={copter} session={status({ kind: 'compass', phase: 'done', reboot: true, compass: progress })} dict={dict} />)
    expect(within(screen.getByTestId('calib-compass')).getByRole('button', { name: '機体を再起動' })).toBeInTheDocument()
  })

  it('the RC card shows the swept range and finishes', async () => {
    const { posts } = setup({ session: status({ kind: 'rc', rc: [{ min: 1000, max: 2000, value: 1500 }, { min: 0, max: 0, value: 0 }] }) })
    const card = screen.getByTestId('calib-rc')
    expect(within(card).getByText('CH1')).toBeInTheDocument()
    expect(within(card).queryByText('CH2')).toBeNull()
    expect(within(card).getByText('1000–2000')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: '完了' }))
    await waitFor(() => expect(posts()[0]?.url).toBe('/api/vehicles/1/calibration/finish'))
  })

  it('motors spin only after the propellers-off switch, with a confirm token', async () => {
    const { posts } = setup()
    const card = screen.getByTestId('calib-motor')
    // the motor test is not a calibration
    fireEvent.click(within(card).getByRole('button', { name: 'テストを開始' }))
    const m2 = await within(card).findByRole('button', { name: 'B' })
    expect(m2).toBeDisabled()
    fireEvent.click(within(card).getByRole('switch', { name: 'プロペラを外しました' }))
    fireEvent.click(m2)
    await waitFor(() => expect(posts().map((p) => p.url)).toEqual(['/api/vehicles/1/confirm', '/api/vehicles/1/motor-test']))
    expect(posts()[0]?.body).toEqual({ cmd: 'motor_test' })
    expect(posts()[1]?.body).toEqual({ motor: 2, pct: 5, seconds: 2, count: 0, confirm_token: 'tok' })
    expect(await within(card).findByText('B を回しました')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: '全モーターを順に' }))
    await waitFor(() => expect(posts()[3]?.body).toEqual({ motor: 1, pct: 5, seconds: 2, count: 4, confirm_token: 'tok' }))
  })

  it('nothing starts on an armed vehicle', async () => {
    setup({ vehicle: { ...copter, armed: true } })
    await act(async () => {})
    for (const b of screen.getAllByRole('button', { name: /校正を開始|テストを開始/ })) expect(b).toBeDisabled()
    expect(screen.getByText(dict.calArmed)).toBeInTheDocument()
  })

  it('a plane gets no ESC or motor cards', () => {
    setup({ vehicle: { ...copter, kind: 'plane' } })
    expect(screen.queryByTestId('calib-esc')).toBeNull()
    expect(screen.queryByTestId('calib-motor')).toBeNull()
  })
})
