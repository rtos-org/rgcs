import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InspectionTemplate, Operator, VehicleRegistry, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { setThemePref, THEME_KEY } from '../../shared/theme/theme'
import { AppTab } from './AppTab'

const copter: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'STABILIZE', armed: false, lat: 0, lon: 0, alt_rel: 0, alt_msl: 0, hdg: 0,
  ground_speed: 0, climb: 0, battery: { pct: 90, volt: 24, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 0, sats: 0, hdop: null }, warn: false, unread: 0,
}
const registry: VehicleRegistry = {
  sysid: 1, name: 'UAV-01', registration: '', uas_type: '', model: '', type_cert_no: '', airworthiness_class: '', airworthiness_no: '', manufacturer: '', serial_no: '',
  initial_flight_minutes: 0, inspection_template_id: null, endurance_minutes: null, total_flight_minutes: 0,
}
const template: InspectionTemplate = { id: 1, name: '様式2 標準', version: 1, items: [{ label: '機体全般', detail: 'x' }], updated_at: 0 }
const settings = { lang: 'ja', map_tile_url: 'x', map_attribution: 'y', map: { gimbal_ground_projection: false, track_minutes: 10 }, basemaps: [], mavlink: { gcs_sysid: 255 } }
const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status, headers: { 'content-type': 'application/json' } })

function setup(role: Operator['role'] = 'admin') {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/registry') && init?.method === 'PUT') return ok({ ...registry, ...(JSON.parse(String(init.body)) as object), total_flight_minutes: 125 })
      if (url.endsWith('/registry')) return ok(registry)
      if (url.endsWith('/users/me/pilot') && init?.method === 'PUT') return ok({ username: 'admin', ...(JSON.parse(String(init.body)) as object) })
      if (url.endsWith('/users/me/pilot')) return ok({ username: 'admin', full_name: '', license_no: '' })
      if (url.endsWith('/inspection/templates')) return ok([template])
      if (url.endsWith('/settings/app') && init?.method === 'PUT') {
        // like the server: the full settings come back, with only the sent values changed
        const put = JSON.parse(String(init.body)) as { map?: object; mavlink?: object }
        return ok({ ...settings, map: { ...settings.map, ...put.map }, mavlink: { ...settings.mavlink, ...put.mavlink } })
      }
      if (url.endsWith('/settings/app')) return ok(settings)
      return ok(null, 404)
    }),
  )
  const onOpenPresent = vi.fn()
  const onOpenGuard = vi.fn()
  const onOpenEnv = vi.fn()
  const me: Operator = { username: 'admin', role, dev_mode: true }
  render(<AppTab sysid={1} vehicle={copter} me={me} dict={t('ja')} onOpenPresent={onOpenPresent} onOpenGuard={onOpenGuard} onOpenEnv={onOpenEnv} />)
  return { calls, onOpenPresent, onOpenGuard, onOpenEnv }
}

describe('AppTab', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('display_card_stores_the_theme_choice_per_browser', () => {
    setup()
    const card = screen.getByTestId('display-card')
    expect(within(card).getByRole('button', { name: '自動' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(card).getByRole('button', { name: 'ライト' }))
    expect(localStorage.getItem(THEME_KEY)).toBe('light')
    expect(within(card).getByRole('button', { name: 'ライト' })).toHaveAttribute('aria-pressed', 'true')
    setThemePref('auto')
  })

  it('registry_form_loads_and_saves_for_admin', async () => {
    const { calls } = setup()
    await waitFor(() => expect(screen.getByLabelText('登録記号(届出番号)')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('登録記号(届出番号)'), { target: { value: 'JU1234567890' } })
    fireEvent.change(screen.getByLabelText('製造後総飛行時間の初期値(分)'), { target: { value: '125' } })
    const card = screen.getByTestId('registry-card')
    fireEvent.click(within(card).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/registry') && c.init?.method === 'PUT')).toBe(true))
    const body = JSON.parse(String(calls.find((c) => c.init?.method === 'PUT')?.init?.body)) as Record<string, unknown>
    expect(body).toMatchObject({ registration: 'JU1234567890', initial_flight_minutes: 125, name: 'UAV-01' })
    await waitFor(() => expect(within(card).getByText('保存しました')).toBeInTheDocument())
    expect(within(card).getByText(/125 分/)).toBeInTheDocument()
  })

  it('registry_form_saves_endurance_minutes', async () => {
    const { calls } = setup()
    await waitFor(() => expect(screen.getByLabelText('飛行可能時間 (分)')).toBeInTheDocument())
    expect(screen.getByText('プランの比較でバッテリーの目安に使います')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('飛行可能時間 (分)'), { target: { value: '25' } })
    fireEvent.click(within(screen.getByTestId('registry-card')).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT' && c.url.endsWith('/registry'))).toBe(true))
    const body = JSON.parse(String(calls.find((c) => c.init?.method === 'PUT')?.init?.body)) as Record<string, unknown>
    expect(body).toMatchObject({ endurance_minutes: 25 })
  })

  it('operator_sees_registry_read_only', async () => {
    setup('operator')
    await waitFor(() => expect(screen.getByLabelText('登録記号(届出番号)')).toBeInTheDocument())
    expect(screen.getByLabelText('登録記号(届出番号)')).toBeDisabled()
    expect(screen.getByText('管理者のみ変更できます')).toBeInTheDocument()
    expect(within(screen.getByTestId('registry-card')).queryByRole('button', { name: '保存' })).toBeNull()
  })

  it('pilot_form_saves_my_name_and_license', async () => {
    const { calls } = setup('operator')
    await waitFor(() => expect(screen.getByLabelText('氏名')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('氏名'), { target: { value: '山田' } })
    fireEvent.change(screen.getByLabelText('技能証明書番号'), { target: { value: 'T123' } })
    fireEvent.click(within(screen.getByTestId('pilot-card')).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/users/me/pilot') && c.init?.method === 'PUT')).toBe(true))
    expect(JSON.parse(String(calls.find((c) => c.url.endsWith('/users/me/pilot') && c.init?.method === 'PUT')?.init?.body))).toEqual({ full_name: '山田', license_no: 'T123' })
  })

  it('present_button_calls_the_callback_and_language_toggles', async () => {
    const { onOpenPresent } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'リンクとロゴを管理…' }))
    expect(onOpenPresent).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '日本語' }).className).toContain('on')
  })
  it('experimental_and_external_factor_cards_open_their_sheets', () => {
    const { onOpenGuard, onOpenEnv } = setup('operator')
    const guard = screen.getByTestId('guard-card')
    expect(within(guard).getByText('実験機能')).toBeInTheDocument()
    expect(within(guard).getByText(/AI 緊急介入/)).toBeInTheDocument()
    fireEvent.click(within(guard).getByRole('button', { name: '設定' }))
    expect(onOpenGuard).toHaveBeenCalledTimes(1)
    const env = screen.getByTestId('env-card')
    expect(within(env).getByText('外的要因データ')).toBeInTheDocument()
    fireEvent.click(within(env).getByRole('button', { name: '設定' }))
    expect(onOpenEnv).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('display-card')).toBeInTheDocument()
  })
  it('map_display_switch_toggles_and_saves', async () => {
    const { calls } = setup()
    const sw = await screen.findByRole('switch', { name: 'ジンバルを地面に投影' })
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'))
    expect(screen.getByText('地図表示')).toBeInTheDocument()
    expect(screen.getByText(/オフの場合は撮影方向のみを表示します/)).toBeInTheDocument()
    fireEvent.click(sw)
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'))
    const put = calls.find((c) => c.url.endsWith('/settings/app') && c.init?.method === 'PUT')
    expect(JSON.parse(String(put?.init?.body))).toEqual({ map: { gimbal_ground_projection: true } })
  })
  it('track_minutes_saves_only_its_own_value_and_rejects_out_of_range', async () => {
    const { calls } = setup()
    const input = await screen.findByLabelText('軌跡を残す時間 (分)')
    await waitFor(() => expect(input).toHaveValue(10))
    const card = screen.getByTestId('map-display-card')
    fireEvent.change(input, { target: { value: '121' } })
    fireEvent.click(within(card).getByRole('button', { name: '保存' }))
    expect(await within(card).findByText('0〜120 分で入力してください')).toBeInTheDocument()
    expect(calls.some((c) => String(c.init?.body).includes('track_minutes'))).toBe(false)
    fireEvent.change(input, { target: { value: '30' } })
    fireEvent.click(within(card).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => String(c.init?.body).includes('track_minutes'))).toBe(true))
    const put = calls.find((c) => String(c.init?.body).includes('track_minutes'))
    expect(JSON.parse(String(put?.init?.body))).toEqual({ map: { track_minutes: 30 } })
  })
  it('mavlink_card_saves_the_sysid', async () => {
    const { calls } = setup()
    const input = await screen.findByLabelText('RGCS の SYSID')
    await waitFor(() => expect(input).toHaveValue(255))
    fireEvent.change(input, { target: { value: '250' } })
    const card = screen.getByTestId('mavlink-card')
    fireEvent.click(within(card).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/settings/app') && c.init?.method === 'PUT' && String(c.init.body).includes('gcs_sysid'))).toBe(true))
    const put = calls.find((c) => String(c.init?.body).includes('gcs_sysid'))
    expect(JSON.parse(String(put?.init?.body))).toEqual({ mavlink: { gcs_sysid: 250 } })
  })

  it('mavlink_card_is_read_only_for_operators', async () => {
    setup('operator')
    const input = await screen.findByLabelText('RGCS の SYSID')
    expect(input).toBeDisabled()
  })
})
