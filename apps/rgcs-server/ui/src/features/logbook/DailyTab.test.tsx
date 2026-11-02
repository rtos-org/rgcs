import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InspectionRun, InspectionTemplate, MaintenanceInput, Operator, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { DailyTab } from './DailyTab'

const copter: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'STABILIZE', armed: false, lat: 35.481883, lon: 138.48029, alt_rel: 0, alt_msl: 0, hdg: 0,
  ground_speed: 0, climb: 0, battery: { pct: 90, volt: 24, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
}
const me: Operator = { username: 'admin', role: 'admin', dev_mode: true }
const labels = ['機体全般', 'プロペラ', 'フレーム', '通信系統', '推進系統', '電源系統', '自動制御系統', '操縦装置', 'バッテリー、燃料']
const template: InspectionTemplate = { id: 1, name: '様式2 標準', version: 1, items: labels.map((label) => ({ label, detail: `${label}の点検` })), updated_at: 0 }
const run = (id: number, hasNg: boolean): InspectionRun => ({
  id, sysid: 1, template_id: 1, template_name: '様式2 標準', template_version: 1, place: 'テスト場', lat: null, lon: null, performed_on: `2026-12-0${id}`,
  inspector: 'admin', notes: '', results: labels.map((label, i) => ({ position: i + 1, label, detail: '', result: hasNg && i === 1 ? 'ng' : 'ok', remark: '' })),
  has_ng: hasNg, supersedes: null, created_by: 'admin', created_at: id,
})
const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status, headers: { 'content-type': 'application/json' } })

function setup(opts: { fix?: number; runs?: InspectionRun[] } = {}) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.endsWith('/inspections/template')) return ok(template)
    if (url.includes('/inspections') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { results: { position: number; result: string }[]; place: string; lat: number | null }
      const hasNg = body.results.some((r) => r.result === 'ng')
      return ok({ ...run(9, hasNg), place: body.place, lat: body.lat }, 201)
    }
    if (url.includes('/inspections')) return ok(opts.runs ?? [])
    return ok(null, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  const onMaintenanceDraft = vi.fn<(d: MaintenanceInput) => void>()
  const vehicle = { ...copter, gps: { ...copter.gps, fix: opts.fix ?? 3 } }
  render(<DailyTab sysid={1} vehicle={vehicle} me={me} dict={t('ja')} onMaintenanceDraft={onMaintenanceDraft} />)
  return { calls, onMaintenanceDraft }
}

const postBody = (calls: { url: string; init?: RequestInit }[]) => {
  const post = calls.find((c) => c.init?.method === 'POST')
  return JSON.parse(String(post?.init?.body)) as { results: { position: number; result: string; remark: string }[]; place: string; lat: number | null; lon: number | null; inspector: string; performed_on: string }
}

describe('DailyTab', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders_the_nine_template_items_defaulting_to_skipped', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('プロペラ')).toBeInTheDocument())
    const rows = screen.getAllByTestId('inspection-item')
    expect(rows).toHaveLength(9)
    for (const row of rows) expect(within(row).getByRole('button', { name: '未実施' }).className).toContain('on')
    expect(screen.getByLabelText('実施者')).toHaveValue('admin')
    expect(screen.getByLabelText('実施年月日')).toHaveValue(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date()))
  })

  it('saves_a_run_with_results_and_shows_the_ng_hint', async () => {
    const { calls, onMaintenanceDraft } = setup()
    await waitFor(() => expect(screen.getByText('プロペラ')).toBeInTheDocument())
    const rows = screen.getAllByTestId('inspection-item')
    for (const row of rows) fireEvent.click(within(row).getByRole('button', { name: '正常' }))
    fireEvent.click(within(rows[1]).getByRole('button', { name: '異常' }))
    fireEvent.change(within(rows[1]).getByRole('textbox'), { target: { value: '欠け' } })
    fireEvent.change(screen.getByLabelText('実施場所'), { target: { value: 'テスト場' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.getByText('保存しました')).toBeInTheDocument())
    const body = postBody(calls)
    expect(body.results).toHaveLength(9)
    expect(body.results[1]).toEqual({ position: 2, result: 'ng', remark: '欠け' })
    expect(body.results[0].result).toBe('ok')
    expect(body.place).toBe('テスト場')
    expect(screen.getByText('異常があります。点検整備記録に下書きを作れます')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '点検整備記録の下書きを作る' }))
    expect(onMaintenanceDraft).toHaveBeenCalledWith(expect.objectContaining({ detail: '日常点検で異常: プロペラ', reason: '日常点検', place: 'テスト場', engineer: 'admin' }))
    // the form resets to 未実施
    for (const row of screen.getAllByTestId('inspection-item')) expect(within(row).getByRole('button', { name: '未実施' }).className).toContain('on')
    // the list reloaded after the save
    expect(calls.filter((c) => /\/inspections(\?|$)/.test(c.url) && c.init?.method !== 'POST').length).toBeGreaterThanOrEqual(2)
  })

  it('uses_the_vehicle_position', async () => {
    const { calls } = setup({ fix: 3 })
    await waitFor(() => expect(screen.getByText('プロペラ')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '機体の位置を使う' }))
    expect(screen.getByText('35.48188, 138.48029')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.getByText('保存しました')).toBeInTheDocument())
    expect(postBody(calls).lat).toBeCloseTo(35.481883)
    expect(postBody(calls).lon).toBeCloseTo(138.48029)
  })

  it('position_button_is_disabled_without_a_fix', async () => {
    setup({ fix: 0 })
    await waitFor(() => expect(screen.getByText('プロペラ')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '機体の位置を使う' })).toBeDisabled()
  })

  it('lists_recent_runs_newest_first', async () => {
    setup({ runs: [run(2, true), run(1, false)] })
    await waitFor(() => expect(screen.getAllByTestId('inspection-run')).toHaveLength(2))
    const rows = screen.getAllByTestId('inspection-run')
    expect(rows[0]).toHaveTextContent('2026-12-02')
    expect(rows[0]).toHaveTextContent('異常 1')
    expect(rows[1]).toHaveTextContent('9/9 正常')
    fireEvent.click(rows[0])
    const details = rows[0].nextElementSibling as HTMLElement
    expect(within(details).getByText('プロペラ')).toBeInTheDocument()
    expect(within(details).getAllByText('異常')).toHaveLength(1)
  })

  it('correct_a_saved_run_supersedes_it', async () => {
    const { calls } = setup({ runs: [run(2, true)] })
    await waitFor(() => expect(screen.getAllByTestId('inspection-run')).toHaveLength(1))
    fireEvent.click(screen.getAllByTestId('inspection-run')[0])
    fireEvent.click(screen.getByRole('button', { name: '訂正' }))
    expect(screen.getByText('訂正中: 2026-12-02 の記録')).toBeInTheDocument()
    const rows = screen.getAllByTestId('inspection-item')
    expect(within(rows[1]).getByRole('button', { name: '異常' }).className).toContain('on')
    expect(screen.getByLabelText('実施場所')).toHaveValue('テスト場')
    expect(screen.getByLabelText('実施年月日')).toHaveValue('2026-12-02')
    fireEvent.click(within(rows[1]).getByRole('button', { name: '正常' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST')).toBe(true))
    const body = JSON.parse(String(calls.find((c) => c.init?.method === 'POST')?.init?.body)) as { supersedes: number | null; results: { result: string }[]; performed_on: string }
    expect(body.supersedes).toBe(2)
    expect(body.results[1].result).toBe('ok')
    expect(body.performed_on).toBe('2026-12-02')
    await waitFor(() => expect(screen.queryByText(/訂正中/)).toBeNull())
  })

  it('cancel_a_correction_returns_to_a_new_run', async () => {
    setup({ runs: [run(2, true)] })
    await waitFor(() => expect(screen.getAllByTestId('inspection-run')).toHaveLength(1))
    fireEvent.click(screen.getAllByTestId('inspection-run')[0])
    fireEvent.click(screen.getByRole('button', { name: '訂正' }))
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByText(/訂正中/)).toBeNull()
    expect(within(screen.getAllByTestId('inspection-item')[1]).getByRole('button', { name: '未実施' }).className).toContain('on')
  })
})
