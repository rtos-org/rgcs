import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendGuided } from './api'

describe('sendGuided', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts the body to /guided and returns id + warning', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { id: 3, warning: 'fence_unknown' } }), { status: 200 }))
    const r = await sendGuided(1, { lat: 36.1, lon: 139.3, alt_mode: 'set', alt_rel: 40, confirm_token: 'tok' })
    expect(r).toEqual({ id: 3, warning: 'fence_unknown' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/vehicles/1/guided')
    expect(JSON.parse(String(init?.body))).toEqual({ lat: 36.1, lon: 139.3, alt_mode: 'set', alt_rel: 40, confirm_token: 'tok' })
  })
})
