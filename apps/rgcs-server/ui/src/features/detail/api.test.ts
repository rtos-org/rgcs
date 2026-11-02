import { afterEach, describe, expect, it, vi } from 'vitest'
import { ackMessage } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('ackMessage', () => {
  it('posts to the vehicle message ack endpoint and returns the entry', async () => {
    const entry = { id: 5, ts: 1, sysid: 2, source: 'vehicle', severity: 'warn', text: 'x', ackable: true, acked_by: 'admin', acked_at: 9 }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: entry }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(ackMessage(2, 5)).resolves.toEqual(entry)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/vehicles/2/messages/5/ack')
    expect(init.method).toBe('POST')
  })
})
