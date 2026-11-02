import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EnvSettings, EnvSourceStatus, EnvThresholds, GuardSettings } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { EnvSourcesSheet } from './EnvSourcesSheet'

const AT = 1_761_400_000_000 // 22:46:40 JST
const NEXT = 1_761_400_600_000 // 22:56:40 JST

const src = (id: string, over: Partial<EnvSourceStatus> = {}): EnvSourceStatus => ({
  id, label: id, enabled: true, needs_key: false, key_configured: false, key_hint: null, uses_location: false,
  interval_s: 600, timeout_ms: 8000, last_ok_ms: null, last_error: null, next_due_ms: null, terms: '', ...over,
})
const sources: EnvSourceStatus[] = [
  src('open_meteo', { uses_location: true, last_ok_ms: AT, next_due_ms: NEXT }),
  src('jma_amedas', { last_error: 'timeout' }),
  src('swpc_kp', { interval_s: 900 }),
  src('swpc_kp_1m', { interval_s: 300 }),
  src('swpc_kp_forecast', { interval_s: 3600 }),
  src('swpc_alerts', { interval_s: 900 }),
  src('gfz_kp', { enabled: false, interval_s: 3600 }),
  src('openweathermap', { enabled: false, needs_key: true, uses_location: true }),
]
const th = (wind: [number, number], gust: [number, number]): EnvThresholds => ({
  wind, gust, precip: [0.5, 2], temp_low: [0, -10], temp_high: [35, 40], kp: [5, 7], declination: [2, 5], sats: [10, 6], hdop: [2, 4], sunset_min: [30, 10],
})
const settings: EnvSettings = { rounding_deg: 0.01, copter: th([8.4, 12], [10.5, 15]), quadplane: th([10.5, 15], [12.6, 18]), plane: th([12.6, 18], [15.4, 22]) }
const guard = (external_data: boolean): GuardSettings => ({
  enabled: true, consent: { monitoring: true, external_data, auto_ops: false, by: 'admin', at_ms: AT }, toilet_bowl: 'l1', countdown_s: 5, takeover_wait_s: 20, params: null,
})

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const ok = (data: unknown) => reply(200, { success: true, data })

interface Call {
  readonly url: string
  readonly method: string
  readonly body: unknown
}

function rig(opts: { readonly list?: EnvSourceStatus[]; readonly externalData?: boolean } = {}) {
  const calls: Call[] = []
  const list = opts.list ?? sources
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined
      calls.push({ url, method, body })
      if (url === '/api/env/sources') return ok(list)
      if (url === '/api/env/settings' && method === 'PUT') return ok({ ...settings, ...(body as object) })
      if (url === '/api/env/settings') return ok(settings)
      if (url === '/api/guard/settings') return ok(guard(opts.externalData ?? true))
      const fetchNow = url.match(/^\/api\/env\/sources\/(\w+)\/fetch$/)
      if (fetchNow) return ok({ ...list.find((s) => s.id === fetchNow[1]), last_ok_ms: AT, last_error: null })
      const put = url.match(/^\/api\/env\/sources\/(\w+)$/)
      if (put && method === 'PUT') return ok({ ...list.find((s) => s.id === put[1]), ...(body as object) })
      return reply(404, { success: false, error: { code: 'not_found', message: url } })
    }),
  )
  return { calls }
}

const show = (isAdmin = true) => render(<EnvSourcesSheet isAdmin={isAdmin} dict={t('ja')} onClose={() => {}} />)
const row = (id: string) => screen.getByTestId(`env-src-${id}`)

describe('EnvSourcesSheet', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists_the_sources_in_order_and_nict_as_unsupported', async () => {
    rig()
    show()
    await screen.findByTestId('env-src-open_meteo')
    const rows = screen.getAllByTestId(/^env-src-/).filter((el) => el.classList.contains('env-src'))
    const titles = rows.map((el) => within(el).getByTestId('env-src-title').textContent)
    expect(titles).toEqual(['Open-Meteo', '気象庁 アメダス', 'NOAA SWPC Kp', 'Kp(1 分推定)', 'Kp 予報', 'SWPC 警報', 'GFZ Kp', 'OpenWeatherMap', 'NICT 宇宙天気予報 — 機械可読の配信なし(未対応)'])
    expect(within(row('nict')).queryByRole('switch')).toBeNull()
    expect(within(row('nict')).getByRole('link')).toHaveAttribute('href', 'https://swc.nict.go.jp/')
  })

  it('each_row_shows_switch_interval_timeout_status_and_next_due', async () => {
    rig()
    show()
    const om = await screen.findByTestId('env-src-open_meteo')
    expect(within(om).getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    expect(within(om).getByLabelText('更新間隔 (秒)')).toHaveValue(600)
    expect(within(om).getByLabelText('タイムアウト (ms)')).toHaveValue(8000)
    expect(within(om).getByTestId('env-src-status')).toHaveTextContent('成功 22:46:40')
    expect(within(om).getByTestId('env-src-next')).toHaveTextContent('22:56:40')
    expect(within(row('jma_amedas')).getByTestId('env-src-status')).toHaveTextContent('失敗 タイムアウト')
    expect(within(row('swpc_kp')).getByTestId('env-src-status')).toHaveTextContent('未取得')
  })

  it('fetch_now_calls_the_endpoint_and_updates_the_row', async () => {
    const { calls } = rig()
    show()
    const amedas = await screen.findByTestId('env-src-jma_amedas')
    fireEvent.click(within(amedas).getByRole('button', { name: '今すぐ取得' }))
    await waitFor(() => expect(within(row('jma_amedas')).getByTestId('env-src-status')).toHaveTextContent('成功 22:46:40'))
    expect(calls.some((c) => c.url === '/api/env/sources/jma_amedas/fetch' && c.method === 'POST')).toBe(true)
  })

  it('the_switch_and_the_numbers_save_with_put', async () => {
    const { calls } = rig()
    show()
    const gfz = await screen.findByTestId('env-src-gfz_kp')
    fireEvent.click(within(gfz).getByRole('switch'))
    await waitFor(() => expect(within(row('gfz_kp')).getByRole('switch')).toHaveAttribute('aria-checked', 'true'))
    expect(calls.find((c) => c.url === '/api/env/sources/gfz_kp' && c.method === 'PUT')?.body).toEqual({ enabled: true })
    fireEvent.change(within(row('swpc_kp')).getByLabelText('更新間隔 (秒)'), { target: { value: '30' } })
    fireEvent.click(within(row('swpc_kp')).getByRole('button', { name: '保存' }))
    expect(await within(row('swpc_kp')).findByText('更新間隔は 60〜86400 秒、タイムアウトは 1000〜30000 ms です')).toBeInTheDocument()
    expect(calls.some((c) => c.url === '/api/env/sources/swpc_kp')).toBe(false)
    fireEvent.change(within(row('swpc_kp')).getByLabelText('更新間隔 (秒)'), { target: { value: '1200' } })
    fireEvent.click(within(row('swpc_kp')).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.find((c) => c.url === '/api/env/sources/swpc_kp')?.body).toEqual({ interval_s: 1200, timeout_ms: 8000 }))
  })

  it('the_key_line_shows_only_the_hint_and_no_key_input_exists', async () => {
    rig()
    const view = show()
    const owm = await screen.findByTestId('env-src-openweathermap')
    expect(owm).toHaveTextContent('キー: 未設定(config.toml の [env])')
    view.unmount()
    rig({ list: sources.map((s) => (s.id === 'openweathermap' ? { ...s, key_configured: true, key_hint: '…9f3a' } : s)) })
    show()
    expect(await screen.findByTestId('env-src-openweathermap')).toHaveTextContent('キー: 設定済み …9f3a')
    expect(document.querySelector('input[type="password"]')).toBeNull()
    expect(screen.queryByLabelText(/キー/)).toBeNull()
  })

  it('rounding_offers_three_steps_and_saves', async () => {
    const { calls } = rig()
    show()
    const select = await screen.findByLabelText('位置の丸め')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['0.01°', '0.05°', '0.1°'])
    await waitFor(() => expect(select).toHaveValue('0.01'))
    fireEvent.change(select, { target: { value: '0.1' } })
    await waitFor(() => expect(calls.find((c) => c.url === '/api/env/settings' && c.method === 'PUT')?.body).toEqual({ rounding_deg: 0.1 }))
  })

  it('shows_the_external_data_consent_state', async () => {
    rig({ externalData: false })
    show()
    expect(await screen.findByText('外部送信の同意: なし — 取得しません')).toBeInTheDocument()
  })

  it('shows_the_offline_note_and_the_terms_lines', async () => {
    rig()
    show()
    expect(await screen.findByText('インターネットが無いときは『外的要因: 取得できず』と表示し、機体テレメトリだけで監視を続けます')).toBeInTheDocument()
    await screen.findByTestId('env-src-open_meteo')
    expect(row('open_meteo')).toHaveTextContent('非商用は無料・商用はキーが必要')
    expect(row('jma_amedas')).toHaveTextContent('出典: 気象庁ホームページ')
    expect(row('swpc_kp')).toHaveTextContent('NOAA SWPC public domain')
  })

  it('threshold_table_shows_three_airframes_and_saves', async () => {
    const { calls } = rig()
    show()
    const table = await screen.findByTestId('env-thresholds')
    for (const h of ['コプター', 'クワッドプレーン', '固定翼']) expect(within(table).getByText(h)).toBeInTheDocument()
    expect(within(table).getAllByText('警告')).toHaveLength(3)
    expect(within(table).getAllByText('強い警告')).toHaveLength(3)
    const wind = await within(table).findByLabelText('風 コプター 警告')
    expect(wind).toHaveValue(8.4)
    fireEvent.change(wind, { target: { value: '9' } })
    fireEvent.click(within(table).getByRole('button', { name: '閾値を保存' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/env/settings' && c.method === 'PUT')).toBe(true))
    const body = calls.find((c) => c.url === '/api/env/settings' && c.method === 'PUT')?.body as EnvSettings
    expect(body.copter.wind).toEqual([9, 12])
    expect(body.plane).toEqual(settings.plane)
    expect('rounding_deg' in body).toBe(false)
  })

  it('operators_see_everything_read_only', async () => {
    rig()
    show(false)
    const om = await screen.findByTestId('env-src-open_meteo')
    expect(within(om).getByRole('switch')).toBeDisabled()
    expect(within(om).queryByRole('button', { name: '今すぐ取得' })).toBeNull()
    expect(screen.getByLabelText('位置の丸め')).toBeDisabled()
    expect(screen.queryByRole('button', { name: '閾値を保存' })).toBeNull()
  })
})
