import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MaintenanceInput, Operator, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { monthRange } from './format'
import { LogbookTab } from './LogbookTab'

const copter: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'STABILIZE', armed: false, lat: 35.481883, lon: 138.48029, alt_rel: 0, alt_msl: 0, hdg: 0,
  ground_speed: 0, climb: 0, battery: { pct: 90, volt: 24, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
}
const me: Operator = { username: 'admin', role: 'admin', dev_mode: true }
const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status, headers: { 'content-type': 'application/json' } })

function setup(maintDraft: MaintenanceInput | null = null) {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.includes('/maintenance') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as MaintenanceInput
        return ok({ id: 5, sysid: 1, total_minutes: 12, created_by: 'admin', created_at: 0, ...body }, 201)
      }
      return ok([])
    }),
  )
  const onConsumed = vi.fn()
  render(<LogbookTab sysid={1} vehicles={new Map([[1, copter]])} me={me} dict={t('ja')} draft={undefined} logFetch={undefined} maintDraft={maintDraft} onMaintDraftConsumed={onConsumed} />)
  return { calls, onConsumed }
}

describe('LogbookTab', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('says_the_logbook_times_are_jst', async () => {
    setup()
    expect(await screen.findByText('時刻は日本標準時 (JST、国土交通省の様式)')).toBeInTheDocument()
  })

  it('period_defaults_to_this_month_and_export_links_follow_the_subtab', async () => {
    setup()
    const { from, to } = monthRange(new Date())
    expect(screen.getByLabelText('期間')).toHaveValue(from)
    expect(screen.getByLabelText('〜')).toHaveValue(to)
    const pdf = screen.getByRole('link', { name: 'PDF 出力' })
    expect(pdf).toHaveAttribute('href', `/api/vehicles/1/logbook/export?form=1&from=${from}&to=${to}&format=pdf`)
    expect(pdf).toHaveAttribute('download')
    fireEvent.click(screen.getByRole('button', { name: '点検整備記録' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'CSV 出力' })).toHaveAttribute('href', expect.stringContaining('form=3') as string))
    fireEvent.click(screen.getByRole('button', { name: '日常点検記録' }))
    expect(screen.getByRole('link', { name: 'PDF 出力' })).toHaveAttribute('href', expect.stringContaining('form=2') as string)
    fireEvent.click(screen.getByRole('button', { name: 'ログ' }))
    expect(screen.queryByRole('link', { name: 'PDF 出力' })).toBeNull()
    // changing the period changes the links
    fireEvent.click(screen.getByRole('button', { name: '飛行記録' }))
    fireEvent.change(screen.getByLabelText('期間'), { target: { value: '2026-11-01' } })
    expect(screen.getByRole('link', { name: 'PDF 出力' })).toHaveAttribute('href', expect.stringContaining('from=2026-11-01') as string)
  })

  it('maintenance_prefill_opens_the_subtab_and_fills_the_form', async () => {
    const draft: MaintenanceInput = { performed_on: '2026-12-05', detail: '日常点検で異常: プロペラ', reason: '日常点検', place: 'テスト場', engineer: 'admin', notes: '', supersedes: null }
    const { calls, onConsumed } = setup(draft)
    await waitFor(() => expect(screen.getByRole('button', { name: '点検整備記録' }).className).toContain('on'))
    expect(screen.getByLabelText('点検、修理、改造及び整備の内容')).toHaveValue('日常点検で異常: プロペラ')
    expect(onConsumed).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '点検整備を記録' }))
    await waitFor(() => expect(calls.some((c) => c.url.includes('/maintenance') && c.init?.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.url.includes('/maintenance') && c.init?.method === 'POST')
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({ detail: '日常点検で異常: プロペラ', reason: '日常点検' })
    await waitFor(() => expect(screen.getByText('12 分')).toBeInTheDocument())
  })
})
