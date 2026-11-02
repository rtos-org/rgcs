import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestConfirm, sendCommand } from './api'

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 })

describe('commands api', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('requestConfirm posts {cmd} to /confirm', async () => {
    fetchMock.mockResolvedValue(ok({ confirm_token: 'tok', expires_in: 30 }))
    const r = await requestConfirm(1, 'arm')
    expect(r).toEqual({ confirm_token: 'tok', expires_in: 30 })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/vehicles/1/confirm')
    expect(init?.body).toBe('{"cmd":"arm"}')
  })

  it('sendCommand posts the flat command body with the optional token', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok({ id: 7 })))
    await sendCommand(2, { cmd: 'set_mode', args: { mode: 'AUTO' } }, 'tok')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/vehicles/2/command')
    expect(JSON.parse(String(init?.body))).toEqual({ cmd: 'set_mode', args: { mode: 'AUTO' }, confirm_token: 'tok' })
    await sendCommand(2, { cmd: 'pause' })
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({ cmd: 'pause' })
  })
  it('sendCommand carries the AI proposal id', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok({ id: 8 })))
    await sendCommand(3, { cmd: 'rtl' }, undefined, 'p-1')
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ cmd: 'rtl', ai_proposal_id: 'p-1' })
    await sendCommand(3, { cmd: 'arm' }, 'tok', 'p-2')
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({ cmd: 'arm', confirm_token: 'tok', ai_proposal_id: 'p-2' })
  })

  it('command requests give up after 10 s instead of hanging on a degraded link', async () => {
    fetchMock.mockImplementation((_url, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))))
    vi.useFakeTimers()
    try {
      const p = sendCommand(1, { cmd: 'pause' }).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(10_001)
      expect(await p).toMatchObject({ code: 'timeout' })
      expect(fetchMock.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal)
    } finally {
      vi.useRealTimers()
    }
  })
})
