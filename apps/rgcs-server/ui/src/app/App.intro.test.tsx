import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INTRO_MS } from '../features/auth/intro'
import { IntroStore } from '../features/auth/introStore'
import { AuthStore } from '../features/auth/store'
import { setLang } from '../shared/i18n/lang'
import { App } from './App'

vi.mock('../features/map/MapView', () => ({ MapView: () => <div data-testid="map" /> }))

class FakeSocket {
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((ev: MessageEvent<string>) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onerror: (() => void) | null = null
  send() {}
  close() {}
}

const me = { username: 'admin', role: 'admin', dev_mode: true, hostname: 'rgcs' }

function envelope(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** `/api/auth/me` answers `meStatus`; the login POST always succeeds. */
function stubServer(meStatus: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url === '/api/auth/me') {
        return meStatus === 200 ? envelope(200, { success: true, data: me }) : envelope(401, { success: false, error: { code: 'unauthorized', message: 'x' } })
      }
      if (url === '/api/auth/login' && init?.method === 'POST') return envelope(200, { success: true, data: me })
      if (url === '/api/health') return envelope(200, { success: true, data: { status: 'ok', hostname: 'rgcs', version: '0', dev_mode: true } })
      return envelope(404, { success: false, error: { code: 'not_found', message: url } })
    }),
  )
}

/** A clock the test moves by hand: `run()` fires the one pending phase timer. */
function manualIntro(reduced = false) {
  let t = 0
  let pending: { at: number; fn: () => void } | null = null
  const intro = new IntroStore({
    now: () => t,
    reducedMotion: () => reduced,
    schedule: (fn, ms) => {
      const job = { at: t + ms, fn }
      pending = job
      return () => {
        if (pending === job) pending = null
      }
    },
  })
  const run = async () => {
    const job = pending
    if (job === null) throw new Error('no pending phase timer')
    pending = null
    t = job.at
    await act(async () => job.fn())
    return t
  }
  return { intro, run }
}

async function signIn() {
  fireEvent.change(await screen.findByLabelText('ユーザー名'), { target: { value: 'admin' } })
  fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'admin' } })
  await act(async () => {
    fireEvent.submit(screen.getByRole('form'))
  })
}

describe('sign-in transition', () => {
  beforeEach(() => {
    setLang('ja')
    vi.stubGlobal('WebSocket', FakeSocket)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('gathers clouds, mounts the app under them, clears, then drops the scene', async () => {
    stubServer(401)
    const { intro, run } = manualIntro()
    const { container } = render(<App store={new AuthStore()} intro={intro} />)
    await signIn()
    const clouds = () => container.querySelector('.ls-clouds')
    expect(clouds()).toHaveAttribute('data-phase', 'gather')
    expect(container.querySelector('.shell')).toBeNull()
    expect(screen.getByRole('button', { name: 'サインイン中…' })).toBeDisabled()

    expect(await run()).toBe(INTRO_MS.gatherMin)
    expect(clouds()).toHaveAttribute('data-phase', 'done')
    expect(container.querySelector('.shell')).not.toBeNull()
    expect(document.documentElement.dataset.intro).toBe('done')
    expect(screen.getByRole('button', { name: 'サインインしました' })).toBeDisabled()

    expect(await run()).toBe(INTRO_MS.gatherMin + INTRO_MS.paintMax)
    expect(clouds()).toHaveAttribute('data-phase', 'clear')
    expect(document.documentElement.dataset.intro).toBe('clear')

    await run()
    expect(clouds()).toBeNull()
    expect(container.querySelector('.ls-backdrop')).toBeNull()
    expect(container.querySelector('.ls-ui')).toBeNull()
    expect(container.querySelector('.shell')).not.toBeNull()
    expect(document.documentElement.dataset.intro).toBeUndefined()
  })

  it('reduced motion: no clouds, a short crossfade into the app', async () => {
    stubServer(401)
    const { intro, run } = manualIntro(true)
    const { container } = render(<App store={new AuthStore()} intro={intro} />)
    await signIn()
    expect(container.querySelector('.ls-clouds')).toBeNull()
    expect(container.querySelector('.ls-overlay')).toHaveAttribute('data-phase', 'done')
    expect(container.querySelector('.shell')).not.toBeNull()
    expect(document.documentElement.dataset.intro).toBe('fade')
    expect(await run()).toBe(INTRO_MS.reduced)
    expect(container.querySelector('.ls-overlay')).toBeNull()
    expect(document.documentElement.dataset.intro).toBeUndefined()
  })

  it('a stored session opens the app directly, without the scene', async () => {
    stubServer(200)
    const { intro } = manualIntro()
    const { container } = render(<App store={new AuthStore()} intro={intro} />)
    await screen.findByText('RGCS')
    expect(container.querySelector('.shell')).not.toBeNull()
    expect(container.querySelector('.ls-overlay')).toBeNull()
    expect(container.querySelector('.ls-backdrop')).toBeNull()
    expect(document.documentElement.dataset.intro).toBeUndefined()
  })
})
