import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../../shared/i18n/lang'
import { setThemePref } from '../../shared/theme/theme'
import { IntroStore } from './introStore'
import { AuthStore } from './store'
import { Login } from './Login'

function envelope(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function stubServer(opts: { devMode: boolean; login: { status: number; code: string } }) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url === '/api/health') {
      return envelope(200, { success: true, data: { status: 'ok', hostname: 'pi-01', version: '0.1.0', dev_mode: opts.devMode } })
    }
    if (url === '/api/auth/login' && init?.method === 'POST') {
      if (opts.login.status === 200) {
        return envelope(200, { success: true, data: { username: 'admin', role: 'admin', dev_mode: opts.devMode, hostname: 'pi-01' } })
      }
      return envelope(opts.login.status, { success: false, error: { code: opts.login.code, message: 'x' } })
    }
    return envelope(404, { success: false, error: { code: 'not_found', message: url } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('Login', () => {
  beforeEach(() => {
    localStorage.clear()
    setLang('ja')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the dev badge and note only when dev_mode is true', async () => {
    stubServer({ devMode: true, login: { status: 200, code: '' } })
    const { unmount } = render(<Login store={new AuthStore()} intro={new IntroStore()} />)
    expect(await screen.findByText('開発用')).toBeInTheDocument()
    // label and account on their own lines, the account never split
    expect(screen.getByText('開発用アカウント')).toBeInTheDocument()
    expect(screen.getByText('admin / admin')).toHaveClass('ls-cred')
    expect(screen.getByText(/pi-01/)).toBeInTheDocument()
    unmount()
    stubServer({ devMode: false, login: { status: 200, code: '' } })
    render(<Login store={new AuthStore()} intro={new IntroStore()} />)
    await screen.findByText(/pi-01/)
    expect(screen.queryByText('開発用')).not.toBeInTheDocument()
  })

  it('submits on Enter and shows the invalid-credentials error', async () => {
    const fetchMock = stubServer({ devMode: true, login: { status: 401, code: 'unauthorized' } })
    render(<Login store={new AuthStore()} intro={new IntroStore()} />)
    fireEvent.change(screen.getByLabelText('ユーザー名'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'nope' } })
    fireEvent.submit(screen.getByRole('form'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('ユーザー名またはパスワードが違います')
    expect(alert).toHaveClass('danger')
    const loginCall = fetchMock.mock.calls.find(([u]) => String(u) === '/api/auth/login')!
    expect(loginCall[1]?.body).toBe(JSON.stringify({ username: 'admin', password: 'nope' }))
  })

  it('clears the error when the input changes', async () => {
    stubServer({ devMode: true, login: { status: 401, code: 'unauthorized' } })
    render(<Login store={new AuthStore()} intro={new IntroStore()} />)
    fireEvent.submit(screen.getByRole('form'))
    await screen.findByRole('alert')
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'a' } })
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('shows the locked message on 429', async () => {
    stubServer({ devMode: true, login: { status: 429, code: 'locked' } })
    render(<Login store={new AuthStore()} intro={new IntroStore()} />)
    fireEvent.submit(screen.getByRole('form'))
    expect(await screen.findByRole('alert')).toHaveTextContent('しばらく待ってから再試行してください')
  })

  it('switches language with the segment and persists it', async () => {
    stubServer({ devMode: false, login: { status: 200, code: '' } })
    render(<Login store={new AuthStore()} intro={new IntroStore()} />)
    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(localStorage.getItem('rgcs.lang')).toBe('en')
  })

  it('is a real form for password managers', async () => {
    stubServer({ devMode: false, login: { status: 200, code: '' } })
    render(<Login store={new AuthStore()} intro={new IntroStore()} />)
    expect(screen.getByLabelText('ユーザー名')).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('パスワード')).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByRole('form').tagName).toBe('FORM')
    expect(screen.getByText('出典: 国土地理院(シームレス空中写真)')).toBeInTheDocument()
    await screen.findByText(/pi-01/)
  })

  it('says Signing in while the clouds gather, then marks the fields and focuses the password on failure', async () => {
    stubServer({ devMode: true, login: { status: 401, code: 'unauthorized' } })
    render(<Login store={new AuthStore()} intro={new IntroStore()} />)
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'nope' } })
    fireEvent.submit(screen.getByRole('form'))
    const button = screen.getByRole('button', { name: 'サインイン中…' })
    expect(button).toBeDisabled()
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('サインイン中…')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByLabelText('パスワード')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('ユーザー名')).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(screen.getByLabelText('パスワード')).toHaveFocus())
    expect(screen.getByRole('button', { name: 'ログイン' })).toBeEnabled()
  })

  it('follows the theme setting; both themes show the same server pill, no inert 2D/3D chip and no slogan', async () => {
    stubServer({ devMode: false, login: { status: 200, code: '' } })
    const { container, unmount } = render(<Login store={new AuthStore()} intro={new IntroStore()} />)
    expect(container.querySelector('.ls-ui')).toHaveAttribute('data-theme', 'dark')
    expect(screen.queryByText('2D')).not.toBeInTheDocument()
    expect(container.querySelector('.ls-host')).not.toBeNull()
    expect(screen.queryByText(/SERVER/)).not.toBeInTheDocument()
    // the host is named once, in the pill, titled 接続先
    expect((await screen.findByText('pi-01')).closest('.ls-host')?.getAttribute('title')).toMatch(/^接続先: pi-01/)
    unmount()
    setThemePref('light')
    try {
      const view = render(<Login store={new AuthStore()} intro={new IntroStore()} />)
      expect(view.container.querySelector('.ls-ui')).toHaveAttribute('data-theme', 'light')
      expect(screen.queryByText('直射日光の下でも読みやすく。')).not.toBeInTheDocument()
      expect(view.container.querySelector('.ls-host')).not.toBeNull()
      await screen.findAllByText(/pi-01/)
    } finally {
      setThemePref('auto')
    }
  })

  it('sends one login for a double Enter', async () => {
    const fetchMock = stubServer({ devMode: false, login: { status: 401, code: 'unauthorized' } })
    render(<Login store={new AuthStore()} intro={new IntroStore()} />)
    fireEvent.submit(screen.getByRole('form'))
    fireEvent.submit(screen.getByRole('form'))
    await screen.findByRole('alert')
    expect(fetchMock.mock.calls.filter(([u]) => String(u) === '/api/auth/login')).toHaveLength(1)
  })
})
