import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { InspectorTab } from './InspectorTab'

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } })
const rows = [
  { dir: 'rx', sysid: 1, compid: 1, msg_id: 0, name: 'HEARTBEAT', count: 12, rate_hz: 1, age_ms: 200 },
  { dir: 'tx', sysid: 255, compid: 190, msg_id: 76, name: 'COMMAND_LONG', count: 3, rate_hz: 0, age_ms: 4000 },
]

afterEach(() => vi.unstubAllGlobals())

describe('InspectorTab', () => {
  it('lists received and sent messages and shows the fields of the selected one', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/mavlink/inspector')) return ok({ rows, gcs_sysid: 255 })
      if (url.endsWith('/api/mavlink/inspector/rx/1/1/0')) return ok({ row: rows[0], fields: { custom_mode: 5, mavtype: { type: 'MAV_TYPE_QUADROTOR' } } })
      return ok(null)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<InspectorTab dict={t('ja')} />)
    expect(await screen.findByText('受信')).toBeInTheDocument()
    expect(screen.getByText(/送信 \(RGCS/)).toBeInTheDocument()
    expect(screen.getByText('COMMAND_LONG')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /HEARTBEAT/ }))
    await waitFor(() => expect(screen.getByText('custom_mode')).toBeInTheDocument())
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('MAV_TYPE_QUADROTOR')).toBeInTheDocument()
  })

  it('filters by message name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ rows, gcs_sysid: 255 })))
    render(<InspectorTab dict={t('ja')} />)
    await screen.findByText('HEARTBEAT')
    fireEvent.change(screen.getByPlaceholderText('メッセージ名で絞り込み'), { target: { value: 'heart' } })
    expect(screen.queryByText('COMMAND_LONG')).toBeNull()
  })
})
