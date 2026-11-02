import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ParamEntry, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { MaintView } from './MaintView'

const copter: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'STABILIZE', armed: false, lat: 35.479883, lon: 138.47829, alt_rel: 0, alt_msl: 0, hdg: 0,
  ground_speed: 0, climb: 0, battery: { pct: 90, volt: 24, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
}
const meta = {
  FENCE_ALT_MAX: { n: 'Fence Maximum Altitude', d: 'Maximum altitude allowed before geofence triggers', u: 'm', r: [10, 1000] },
  FENCE_ENABLE: { n: 'Fence enable/disable', d: 'enable or disable the fence', v: { '0': 'Disabled', '1': 'Enabled' } },
  SERIAL1_BAUD: { n: 'Serial 1 baud', d: 'baud rate', reboot: true },
}
const entries: ParamEntry[] = [
  { name: 'FENCE_ALT_MAX', value: 100, index: 1, ptype: 9 },
  { name: 'FENCE_ENABLE', value: 0, index: 2, ptype: 2 },
  { name: 'SERIAL1_BAUD', value: 57, index: 3, ptype: 4 },
  { name: 'WPNAV_SPEED', value: 500, index: 4, ptype: 9 },
]
const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status, headers: { 'content-type': 'application/json' } })
const done = { received: 4, total: 4, complete: true, downloading: false }

function setup(opts: { progress?: typeof done; armed?: boolean } = {}) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.endsWith('/params/arducopter.json')) return new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } })
    if (url.endsWith('/params/refresh')) return ok(opts.progress ?? done, 202)
    if (url.endsWith('/params') && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { changes: { name: string; value: number }[]; confirm_token: string }
      return ok(body.changes.map((c) => ({ name: c.name, requested: c.value, actual: c.name === 'FENCE_ALT_MAX' ? null : c.value, verified: c.name !== 'FENCE_ALT_MAX', reason: c.name === 'FENCE_ALT_MAX' ? 'no_echo' : null })))
    }
    if (url.endsWith('/params')) return ok({ entries, progress: opts.progress ?? done })
    if (url.endsWith('/confirm')) return ok({ confirm_token: 'tok', expires_in: 30 })
    if (url.includes('/api/history/params')) return ok([{ id: 1, ts: '2026-10-18T01:02:03Z', operator: 'admin', sysid: 1, name: 'FENCE_ALT_MAX', old_value: 100, new_value: 150, verified: true }])
    return ok(null, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  const vehicles = new Map([[1, { ...copter, armed: opts.armed ?? false }]])
  const utils = render(<MaintView vehicles={vehicles} paramProgress={new Map()} dict={t('ja')} me={{ username: 'admin', role: 'admin', dev_mode: true }} />)
  return { ...utils, calls, fetchMock }
}

describe('MaintView', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('the vehicle header is hidden on the app-wide アプリ設定 tab', () => {
    setup()
    expect(screen.getByTestId('maint-head')).toHaveTextContent('ディスアーム')
    fireEvent.click(screen.getByRole('button', { name: 'アプリ設定' }))
    expect(screen.queryByTestId('maint-head')).toBeNull()
  })

  it('every maintenance tab is enabled, 点検・校正 opens the calibration cards', () => {
    setup()
    for (const name of ['点検・校正', '日常点検', '飛行日誌', 'アプリ設定']) expect(screen.getByRole('button', { name })).not.toHaveAttribute('aria-disabled')
    fireEvent.click(screen.getByRole('button', { name: '点検・校正' }))
    expect(screen.getByTestId('calib-accel')).toBeInTheDocument()
  })

  it('maint_view_shows_progress_then_rows_and_writes_a_change_set', async () => {
    const { calls } = setup()
    // header + tabs
    // one vehicle selector: the list on the left; the header names the vehicle the tabs act on
    expect(screen.queryByRole('combobox', { name: '対象機体' })).toBeNull()
    expect(screen.getByTestId('maint-head')).toHaveTextContent('対象機体UAV-01')
    expect(screen.getByRole('button', { name: 'パラメータ' }).className).toContain('on')
    // the list loads, metadata attaches
    await waitFor(() => expect(screen.getByText('Fence Maximum Altitude')).toBeInTheDocument())
    expect(screen.getByText('4 / 4')).toBeInTheDocument()
    // search narrows
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'fence' } })
    expect(screen.queryByText('WPNAV_SPEED')).toBeNull()
    expect(screen.getAllByRole('row')).toHaveLength(3) // header + 2
    // edit a value → change set
    const input = within(screen.getByText('FENCE_ALT_MAX').closest('tr')!).getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '150' } })
    fireEvent.blur(input)
    const changes = screen.getByTestId('param-changes')
    expect(within(changes).getByText('FENCE_ALT_MAX')).toBeInTheDocument()
    expect(within(changes).getByText('100 → 150')).toBeInTheDocument()
    // a reboot-required one is flagged
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'serial' } })
    const baud = within(screen.getByText('SERIAL1_BAUD').closest('tr')!).getByRole('spinbutton')
    fireEvent.change(baud, { target: { value: '115' } })
    fireEvent.blur(baud)
    expect(within(changes).getByText('再起動が必要')).toBeInTheDocument()
    // write → confirm → results
    fireEvent.click(within(changes).getByRole('button', { name: '書き込む' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('2 件のパラメータ')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '実行' }))
    await waitFor(() => expect(screen.getByTestId('param-results')).toBeInTheDocument())
    const results = screen.getByTestId('param-results')
    expect(within(results).getByText('FENCE_ALT_MAX').closest('li')!.textContent).toContain('未検証')
    const baudRow = within(results).getByText('SERIAL1_BAUD').closest('li')!
    // a Lucide check, not a ✓ glyph
    expect(baudRow.querySelector('[aria-label="検証済み"]')).not.toBeNull()
    expect(baudRow.textContent).toContain('再起動が必要')
    expect(within(results).getByText('再起動が必要な項目は再起動後に反映されます')).toBeInTheDocument()
    const put = calls.find((c) => c.init?.method === 'PUT')!
    expect(JSON.parse(String(put.init!.body))).toEqual({ changes: [{ name: 'FENCE_ALT_MAX', value: 150 }, { name: 'SERIAL1_BAUD', value: 115 }], confirm_token: 'tok' })
    expect(calls.some((c) => c.url.endsWith('/api/vehicles/1/confirm') && JSON.parse(String(c.init?.body)).cmd === 'param_write')).toBe(true)
    // the change set is empty afterwards
    expect(within(changes).queryByText('100 → 150')).toBeNull()
  })

  it('refresh_posts_and_shows_the_progress_bar_while_downloading', async () => {
    const { calls } = setup()
    await waitFor(() => expect(screen.getByText('4 / 4')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '更新' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/params/refresh') && c.init?.method === 'POST')).toBe(true))
    cleanup()
    vi.unstubAllGlobals()
    setup({ progress: { received: 300, total: 1200, complete: false, downloading: true } })
    await waitFor(() => expect(screen.getByText('300 / 1200')).toBeInTheDocument())
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByRole('button', { name: '更新' })).toBeDisabled()
    // writing is refused during a download: the button stays disabled even with a change
    await waitFor(() => expect(screen.getByText('Fence Maximum Altitude')).toBeInTheDocument())
    const input = within(screen.getByText('FENCE_ALT_MAX').closest('tr')!).getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '150' } })
    fireEvent.blur(input)
    expect(within(screen.getByTestId('param-changes')).getByRole('button', { name: '書き込む' })).toBeDisabled()
  })

  it('history_tab_lists_changes', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '変更履歴' }))
    await waitFor(() => expect(screen.getByText('FENCE_ALT_MAX: 100 → 150')).toBeInTheDocument())
    const row = screen.getByText('FENCE_ALT_MAX: 100 → 150').closest('tr')!
    expect(within(row).getByText('admin')).toBeInTheDocument()
    // a 検証 column with an icon; no 機体 column, the list is already this vehicle's
    expect(within(row).getByLabelText('検証済み')).toBeInTheDocument()
    expect(within(row).queryByText('UAV-01')).toBeNull()
    expect(screen.getByRole('columnheader', { name: '検証' })).toBeInTheDocument()
    expect(within(row).getByText(/^2026-10-1[78] \d\d:02:03$/)).toBeInTheDocument()
  })

  it('armed_vehicle_disables_writing', async () => {
    setup({ armed: true })
    await waitFor(() => expect(screen.getByText('Fence Maximum Altitude')).toBeInTheDocument())
    expect(screen.getByTestId('maint-head')).toHaveTextContent('アーム中')
    const input = within(screen.getByText('FENCE_ALT_MAX').closest('tr')!).getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '150' } })
    fireEvent.blur(input)
    expect(within(screen.getByTestId('param-changes')).getByRole('button', { name: '書き込む' })).toBeDisabled()
  })
})
