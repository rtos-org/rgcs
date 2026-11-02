import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Flight, FlightLog, LogFetchProgress } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { LogsPane } from './LogsPane'

/** 2026-12-05 10:00 JST. */
const T0 = 1_796_050_800_000 + 4 * 86_400_000 + 10 * 3_600_000
const flight: Flight = {
  id: 3, sysid: 1, status: 'draft', pilot: 'admin', pilot_license: '', takeoff_at: T0, landed_at: T0 + 60_000, takeoff_lat: null, takeoff_lon: null,
  landing_lat: null, landing_lon: null, takeoff_place: '', landing_place: '', purposes: [], specific_flight: [], summary: '', safety_notes: '',
  flight_minutes: 1, total_minutes: 1, squawks: [], supersedes: null, created_by: 'system', created_at: 0, updated_at: 0,
}
const stored: FlightLog = { id: 11, sysid: 1, flight_id: null, fc_log_id: 7, filename: '7_1700000000.bin', size: 1_500_000, source: 'mavlink', fetched_at: T0, created_by: 'admin' }
const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status, headers: { 'content-type': 'application/json' } })

function setup(opts: { enabled?: boolean; logs?: FlightLog[]; progress?: LogFetchProgress } = {}) {
  const calls: { url: string; init?: RequestInit }[] = []
  let logs = opts.logs ?? [stored]
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/logs/fc')) return ok([{ id: 7, time_utc: 1_700_000_000, size: 1_500_000 }, { id: 8, time_utc: 1_700_003_600, size: 20_480 }])
      if (url.endsWith('/logs/fetch')) return ok({ fc_log_id: 8 }, 202)
      if (url.includes('/logs/upload')) {
        logs = [{ ...stored, id: 12, source: 'upload', filename: 'upload_1_2026-12-05.bin', size: 300, flight_id: 3 }, ...logs]
        return ok(logs[0], 201)
      }
      if (init?.method === 'PATCH') return ok({ ...stored, flight_id: 3 })
      if (url.endsWith('/logs')) return ok({ fetch_enabled: opts.enabled ?? true, logs })
      if (url.includes('/flights')) return ok([flight])
      return ok(null, 404)
    }),
  )
  const utils = render(<LogsPane sysid={1} from="2026-12-01" to="2026-12-31" dict={t('ja')} progress={opts.progress} />)
  return { calls, ...utils }
}

describe('LogsPane', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists_stored_logs_with_download_links_and_attach_select', async () => {
    const { calls } = setup()
    await waitFor(() => expect(screen.getAllByTestId('log-row')).toHaveLength(1))
    const row = screen.getAllByTestId('log-row')[0]
    expect(row).toHaveTextContent('7_1700000000.bin')
    expect(row).toHaveTextContent('1.4 MB')
    expect(row).toHaveTextContent('mavlink')
    expect(within(row).getByRole('link', { name: 'ダウンロード' })).toHaveAttribute('href', '/api/vehicles/1/logs/11/file')
    const select = within(row).getByRole('combobox', { name: '紐付ける飛行' })
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2))
    fireEvent.change(select, { target: { value: '3' } })
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(true))
    expect(JSON.parse(String(calls.find((c) => c.init?.method === 'PATCH')?.init?.body))).toEqual({ flight_id: 3 })
  })

  it('fc_list_then_fetch_shows_progress_and_reloads_when_done', async () => {
    const { calls, rerender } = setup()
    await waitFor(() => expect(screen.getAllByTestId('log-row')).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '一覧を取得' }))
    await waitFor(() => expect(screen.getAllByTestId('fc-row')).toHaveLength(2))
    const rows = screen.getAllByTestId('fc-row')
    expect(rows[1]).toHaveTextContent('8')
    expect(rows[1]).toHaveTextContent('20 KB')
    fireEvent.click(within(rows[1]).getByRole('button', { name: '取り出す' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/logs/fetch'))).toBe(true))
    expect(JSON.parse(String(calls.find((c) => c.url.endsWith('/logs/fetch'))?.init?.body))).toMatchObject({ fc_log_id: 8 })
    rerender(<LogsPane sysid={1} from="2026-12-01" to="2026-12-31" dict={t('ja')} progress={{ fc_log_id: 8, received: 10_240, total: 20_480, done: false, error: null }} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByText(/取り出し中/)).toBeInTheDocument()
    const before = calls.filter((c) => c.url.endsWith('/logs') && c.init?.method === 'GET').length
    rerender(<LogsPane sysid={1} from="2026-12-01" to="2026-12-31" dict={t('ja')} progress={{ fc_log_id: 8, received: 20_480, total: 20_480, done: true, error: null }} />)
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/logs') && c.init?.method === 'GET').length).toBe(before + 1))
    expect(screen.queryByRole('progressbar')).toBeNull()
    rerender(<LogsPane sysid={1} from="2026-12-01" to="2026-12-31" dict={t('ja')} progress={{ fc_log_id: 8, received: 0, total: 20_480, done: true, error: 'the flight controller did not answer' }} />)
    expect(screen.getByText('the flight controller did not answer')).toBeInTheDocument()
  })

  it('disabled_fetch_shows_the_hint_only', async () => {
    setup({ enabled: false })
    await waitFor(() => expect(screen.getByText(/log_fetch/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '一覧を取得' })).toBeNull()
  })

  it('upload_sends_the_file_with_the_csrf_header', async () => {
    const { calls } = setup()
    await waitFor(() => expect(screen.getAllByTestId('log-row')).toHaveLength(1))
    const upload = screen.getByRole('button', { name: 'ファイルをアップロード' })
    expect(upload).toBeDisabled()
    const file = new File([new Uint8Array(300)], '2026-12-05.bin', { type: 'application/octet-stream' })
    fireEvent.change(screen.getByLabelText('ファイル'), { target: { files: [file] } })
    fireEvent.change(screen.getByLabelText('紐付ける飛行(アップロード)'), { target: { value: '3' } })
    expect(upload).toBeEnabled()
    fireEvent.click(upload)
    await waitFor(() => expect(calls.some((c) => c.url.includes('/logs/upload'))).toBe(true))
    const call = calls.find((c) => c.url.includes('/logs/upload'))
    expect(call?.url).toContain('filename=2026-12-05.bin')
    expect(call?.url).toContain('flight_id=3')
    const headers = (call?.init?.headers ?? {}) as Record<string, string>
    expect(headers['X-Requested-With']).toBe('rgcs')
    expect(call?.init?.body).toBe(file)
    await waitFor(() => expect(screen.getAllByTestId('log-row')).toHaveLength(2))
  })
})
