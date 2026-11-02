import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Flight } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { FlightsPane } from './FlightsPane'

/** 2026-12-05 10:00 JST. */
const T0 = 1_796_050_800_000 + 4 * 86_400_000 + 10 * 3_600_000
const flight = (id: number, status: Flight['status']): Flight => ({
  id, sysid: 1, status, pilot: '山田', pilot_license: 'T123', takeoff_at: T0 + id * 3_600_000, landed_at: T0 + id * 3_600_000 + 90_000,
  takeoff_lat: 35.481883, takeoff_lon: 138.48029, landing_lat: null, landing_lon: null, takeoff_place: '', landing_place: '', purposes: ['空撮'], specific_flight: [],
  summary: '', safety_notes: '', flight_minutes: 2, total_minutes: 100 + 2 * id, squawks: [], supersedes: null, created_by: 'system', created_at: 0, updated_at: 0,
})
const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status, headers: { 'content-type': 'application/json' } })

function setup(flights: Flight[], draft?: Flight) {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (init?.method === 'PATCH') {
        const patch = JSON.parse(String(init.body)) as Partial<Flight>
        const id = Number(url.split('/').pop())
        const base = flights.find((f) => f.id === id) ?? flights[0]
        return ok({ ...base, ...patch, id: patch.status === 'confirmed' ? id : base.status === 'confirmed' ? id + 100 : id })
      }
      if (init?.method === 'DELETE') return ok({ deleted: true })
      if (url.endsWith('/squawks')) return ok({ id: 9, flight_id: 1, occurred_on: '2026-12-05', description: '振動', action_on: '', action: '', confirmer: '', created_by: 'admin', created_at: 0 }, 201)
      return ok(flights)
    }),
  )
  const utils = render(<FlightsPane sysid={1} from="2026-12-01" to="2026-12-31" dict={t('ja')} draft={draft} />)
  return { calls, ...utils }
}

describe('FlightsPane', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists_flights_with_jst_times_and_status_badges', async () => {
    setup([flight(1, 'draft'), flight(2, 'confirmed')])
    await waitFor(() => expect(screen.getAllByTestId('flight-row')).toHaveLength(2))
    const rows = screen.getAllByTestId('flight-row')
    expect(rows[0]).toHaveTextContent('2026-12-05')
    expect(rows[0]).toHaveTextContent('11:00')
    expect(rows[0]).toHaveTextContent('11:01')
    expect(rows[0]).toHaveTextContent('2 分')
    expect(rows[0]).toHaveTextContent('102 分')
    expect(within(rows[0]).getByText('下書き')).toBeInTheDocument()
    expect(within(rows[1]).getByText('確定')).toBeInTheDocument()
    expect(within(rows[0]).getByRole('button', { name: '削除' })).toBeInTheDocument()
    expect(within(rows[1]).queryByRole('button', { name: '削除' })).toBeNull()
  })

  it('edit_a_draft_patches_and_confirm_sends_status', async () => {
    const { calls } = setup([flight(1, 'draft')])
    await waitFor(() => expect(screen.getAllByTestId('flight-row')).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '編集' }))
    const sheet = screen.getByRole('dialog')
    fireEvent.change(within(sheet).getByLabelText('離陸場所'), { target: { value: '熊谷市' } })
    fireEvent.click(within(sheet).getByLabelText('研究開発'))
    fireEvent.click(within(sheet).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(true))
    const patch = JSON.parse(String(calls.find((c) => c.init?.method === 'PATCH')?.init?.body)) as Record<string, unknown>
    expect(patch).toMatchObject({ takeoff_place: '熊谷市', purposes: ['空撮', '研究開発'] })
    expect(patch).not.toHaveProperty('status')
    fireEvent.click(within(sheet).getByRole('button', { name: '確定する' }))
    await waitFor(() => expect(calls.filter((c) => c.init?.method === 'PATCH')).toHaveLength(2))
    expect(JSON.parse(String(calls.filter((c) => c.init?.method === 'PATCH')[1].init?.body))).toMatchObject({ status: 'confirmed' })
    await waitFor(() => expect(within(screen.getAllByTestId('flight-row')[0]).getByText('確定')).toBeInTheDocument())
  })

  it('confirmed_edit_shows_the_correction_note', async () => {
    setup([flight(2, 'confirmed')])
    await waitFor(() => expect(screen.getAllByTestId('flight-row')).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '編集' }))
    expect(screen.getByText('確定済みの記録を編集すると訂正行が追加されます')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: '確定する' })).toBeNull()
  })

  it('delete_only_for_drafts_and_removes_the_row', async () => {
    const { calls } = setup([flight(1, 'draft')])
    await waitFor(() => expect(screen.getAllByTestId('flight-row')).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(true))
    expect(calls.find((c) => c.init?.method === 'DELETE')?.url).toBe('/api/vehicles/1/flights/1')
  })

  it('adds_a_squawk', async () => {
    const { calls } = setup([flight(1, 'draft')])
    await waitFor(() => expect(screen.getAllByTestId('flight-row')).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '編集' }))
    const sheet = screen.getByRole('dialog')
    fireEvent.change(within(sheet).getByLabelText('発生年月日'), { target: { value: '2026-12-05' } })
    fireEvent.change(within(sheet).getByLabelText('不具合事項'), { target: { value: '振動' } })
    fireEvent.click(within(sheet).getByRole('button', { name: '記事を追加' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/squawks'))).toBe(true))
    expect(JSON.parse(String(calls.find((c) => c.url.endsWith('/squawks'))?.init?.body))).toMatchObject({ occurred_on: '2026-12-05', description: '振動' })
    await waitFor(() => expect(within(sheet).getByText('振動')).toBeInTheDocument())
  })

  it('new_draft_frame_reloads_and_shows_the_banner', async () => {
    const { calls, rerender } = setup([flight(1, 'draft')])
    await waitFor(() => expect(screen.getAllByTestId('flight-row')).toHaveLength(1))
    const before = calls.filter((c) => c.init?.method === 'GET').length
    rerender(<FlightsPane sysid={1} from="2026-12-01" to="2026-12-31" dict={t('ja')} draft={flight(7, 'draft')} />)
    await waitFor(() => expect(calls.filter((c) => c.init?.method === 'GET').length).toBe(before + 1))
    expect(screen.getByText('飛行記録の下書きを作成しました')).toBeInTheDocument()
  })
})
