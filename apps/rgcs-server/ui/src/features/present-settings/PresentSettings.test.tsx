import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { PresentSettings } from './PresentSettings'

function envelope(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('PresentSettings', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('creating a token shows the link once and lists it afterwards', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/settings/presentation/tokens' && (init?.method ?? 'GET') === 'GET') return envelope(200, { success: true, data: [] })
      if (url === '/api/settings/presentation/tokens' && init?.method === 'POST') return envelope(200, { success: true, data: { token: 'a'.repeat(32), url: `/present?t=${'a'.repeat(32)}` } })
      return envelope(404, { success: false, error: { code: 'not_found', message: url } })
    })
    render(<PresentSettings isAdmin logo={false} onClose={() => {}} dict={t('ja')} />)
    fireEvent.change(await screen.findByLabelText('ラベル'), { target: { value: '会場' } })
    fireEvent.click(screen.getByRole('button', { name: 'リンクを発行' }))
    const link = await screen.findByTestId('present-link')
    expect(link).toHaveTextContent(`/present?t=${'a'.repeat(32)}`)
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!
    expect(JSON.parse(String(post[1]?.body))).toEqual({ label: '会場' })
  })

  it('revoke calls DELETE with the prefix', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (init?.method === 'DELETE') return envelope(200, { success: true, data: null })
      if (url === '/api/settings/presentation/tokens') {
        return envelope(200, { success: true, data: [{ token_prefix: 'abcdef', label: '会場', created_by: 'admin', created_at: '2026-10-17T00:00:00Z', revoked_at: null }] })
      }
      return envelope(404, { success: false, error: { code: 'not_found', message: url } })
    })
    render(<PresentSettings isAdmin logo={false} onClose={() => {}} dict={t('ja')} />)
    fireEvent.click(await screen.findByRole('button', { name: '無効化' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => String(u) === '/api/settings/presentation/tokens/abcdef' && i?.method === 'DELETE')).toBe(true))
  })

  it('the token table has column headers', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/settings/presentation/tokens') return envelope(200, { success: true, data: [{ label: 'x', token_prefix: 'abcdef', created_at: 1, revoked_at: null }] })
      return envelope(404, { success: false, error: { code: 'not_found', message: url } })
    })
    render(<PresentSettings isAdmin logo={false} onClose={() => {}} dict={t('ja')} />)
    expect(await screen.findByRole('columnheader', { name: 'トークン' })).toBeInTheDocument()
    for (const name of ['ラベル', '状態']) expect(screen.getByRole('columnheader', { name })).toBeInTheDocument()
  })

  it('logo upload PUTs the file with its content-type; operators see no admin controls', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/settings/branding/logo' && init?.method === 'PUT') return envelope(200, { success: true, data: null })
      if (url === '/api/settings/presentation/tokens') return envelope(200, { success: true, data: [] })
      return envelope(404, { success: false, error: { code: 'not_found', message: url } })
    })
    const { unmount } = render(<PresentSettings isAdmin logo={false} onClose={() => {}} dict={t('ja')} />)
    // an app button, not the browser's native "Choose File"
    expect(await screen.findByText('ロゴを選択…')).toBeInTheDocument()
    const file = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })
    fireEvent.change(await screen.findByLabelText('ロゴ画像'), { target: { files: [file] } })
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => String(u) === '/api/settings/branding/logo' && i?.method === 'PUT')).toBe(true))
    const put = fetchMock.mock.calls.find(([u, i]) => String(u) === '/api/settings/branding/logo' && i?.method === 'PUT')!
    expect(new Headers(put[1]?.headers).get('content-type')).toBe('image/svg+xml')
    unmount()
    render(<PresentSettings isAdmin={false} logo={false} onClose={() => {}} dict={t('ja')} />)
    await screen.findByText('観客用画面')
    expect(screen.queryByRole('button', { name: 'リンクを発行' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('ロゴ画像')).not.toBeInTheDocument()
  })
})
