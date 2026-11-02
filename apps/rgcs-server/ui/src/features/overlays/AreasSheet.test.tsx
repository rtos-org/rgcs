import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import type { OverlayArea } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import type { AreasApi } from './api'
import { AreasHub } from './areasHub'
import { AreasSheet } from './AreasSheet'
import { activeOverlays } from './plugins'
import { area, plugin } from './testData'

const VIEW = { south: 33.6, west: 135.8, north: 33.7, east: 135.9 }

function api(p: Partial<AreasApi> = {}): AreasApi {
  return { estimate: vi.fn(async () => 120), create: vi.fn(async () => ({})), refresh: vi.fn(async () => ({})), remove: vi.fn(async () => ({})), ...p }
}

function open(rows: () => OverlayArea[], a: AreasApi = api(), viewRect: () => typeof VIEW | null = () => VIEW) {
  const load = vi.fn(async () => rows())
  const hub = new AreasHub(load)
  const onClose = vi.fn()
  const target = activeOverlays([plugin()])[0]!
  render(<AreasSheet dict={t('ja')} target={target} mapKey="ops" onClose={onClose} api={a} hub={hub} viewRect={viewRect} />)
  return { load, onClose, api: a }
}

describe('AreasSheet', () => {
  it('is_titled_with_the_overlay_name_in_the_ui_language', async () => {
    open(() => [])
    expect(await screen.findByRole('dialog', { name: 'LTE エリア' })).toBeInTheDocument()
  })

  afterEach(() => vi.useRealTimers())

  it('lists_each_area_with_its_status_dates_and_counts', async () => {
    open(() => [area({ status: 'partial', tiles_ok: 8, tiles_failed: 2 })])
    const row = await screen.findByRole('listitem')
    expect(row).toHaveTextContent('Nachi')
    expect(row).toHaveTextContent('一部失敗')
    expect(row).toHaveTextContent('取得日 2026-10-31')
    expect(row).toHaveTextContent('データ更新日 2026-10-01')
    expect(row).toHaveTextContent('成功 8・失敗 2')
    expect(row).toHaveTextContent('33.6000, 135.8500')
  })

  it('adds_the_area_in_view_after_showing_its_tile_count', async () => {
    const { load, api: a } = open(() => [])
    await screen.findByText('範囲はまだありません')
    fireEvent.click(screen.getByRole('button', { name: 'いま表示している範囲を追加' }))
    expect(a.estimate).toHaveBeenCalledWith(VIEW)
    await screen.findByText('120 タイル')
    const fetch = screen.getByRole('button', { name: '取得' })
    expect(fetch).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '名前' }), { target: { value: ' Nachi ' } })
    fireEvent.click(fetch)
    await waitFor(() => expect(a.create).toHaveBeenCalledWith({ name: 'Nachi', ...VIEW }))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('textbox', { name: '名前' })).toBeNull()
  })

  it('refuses_a_view_above_the_tile_limit', async () => {
    open(() => [], api({ estimate: vi.fn(async () => 5000) }))
    fireEvent.click(screen.getByRole('button', { name: 'いま表示している範囲を追加' }))
    await screen.findByText('5000 タイル')
    fireEvent.change(screen.getByRole('textbox', { name: '名前' }), { target: { value: 'big' } })
    expect(screen.getByRole('button', { name: '取得' })).toBeDisabled()
    expect(screen.getByText(/上限 3000/)).toBeInTheDocument()
  })

  it('shows_the_server_reason_when_the_add_is_refused', async () => {
    open(() => [], api({ create: vi.fn(async () => Promise.reject(new ApiError(400, 'bad_rect', 'x'))) }))
    fireEvent.click(screen.getByRole('button', { name: 'いま表示している範囲を追加' }))
    await screen.findByText('120 タイル')
    fireEvent.change(screen.getByRole('textbox', { name: '名前' }), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: '取得' }))
    expect(await screen.findByText('この範囲は取得できません')).toBeInTheDocument()
  })

  it('says_when_there_is_no_map_view', () => {
    open(() => [], api(), () => null)
    fireEvent.click(screen.getByRole('button', { name: 'いま表示している範囲を追加' }))
    expect(screen.getByText('地図の表示範囲を読み取れません')).toBeInTheDocument()
  })

  it('deletes_only_after_the_in_app_confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const { api: a } = open(() => [area()])
    fireEvent.click(await screen.findByRole('button', { name: 'Nachi を削除' }))
    const ask = screen.getByRole('alertdialog')
    expect(a.remove).not.toHaveBeenCalled()
    fireEvent.click(within(ask).getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Nachi を削除' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '削除' }))
    await waitFor(() => expect(a.remove).toHaveBeenCalledWith(1))
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('refreshes_an_area_and_reports_busy', async () => {
    const { api: a } = open(() => [area()], api({ refresh: vi.fn(async () => Promise.reject(new ApiError(409, 'busy', 'x'))) }))
    fireEvent.click(await screen.findByRole('button', { name: '更新' }))
    expect(a.refresh).toHaveBeenCalledWith(1)
    expect(await screen.findByText('取得中のため操作できません')).toBeInTheDocument()
  })

  it('polls_every_second_while_an_area_is_fetching', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let n = 0
    const { load } = open(() => (++n < 3 ? [area({ status: 'fetching', tiles_ok: n, tiles_failed: 0 })] : [area()]))
    expect(await screen.findByText('取得中 1/10')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '更新' })).toBeDisabled()
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(screen.getByText('取得中 2/10')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(screen.getByText('取得済み')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('closes', async () => {
    const { onClose } = open(() => [])
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalled()
  })
})
