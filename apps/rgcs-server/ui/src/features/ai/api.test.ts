import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetch = vi.fn()
vi.mock('../../shared/api/client', async (orig) => ({ ...(await orig<typeof import('../../shared/api/client')>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }))

const { dismissProposal, getAiStatus, postChat } = await import('./api')

describe('ai api', () => {
  beforeEach(() => apiFetch.mockReset().mockResolvedValue({}))
  afterEach(() => vi.clearAllMocks())

  it('getAiStatus reads /api/ai/status', async () => {
    await getAiStatus()
    expect(apiFetch).toHaveBeenCalledWith('/api/ai/status')
  })

  it('postChat posts the body to /api/ai/chat with a 95 s timeout', async () => {
    const body = { sysid: 3, message: 'hi', conversation_id: null }
    await postChat(body)
    expect(apiFetch).toHaveBeenCalledWith('/api/ai/chat', { method: 'POST', body, timeoutMs: 95_000 })
  })

  it('dismissProposal posts to the proposal dismiss path', async () => {
    await dismissProposal('p-1')
    expect(apiFetch).toHaveBeenCalledWith('/api/ai/proposals/p-1/dismiss', { method: 'POST', timeoutMs: 10_000 })
  })

  it('dismissProposal escapes the id', async () => {
    await dismissProposal('p/../x')
    expect(apiFetch.mock.calls[0]![0]).toBe('/api/ai/proposals/p%2F..%2Fx/dismiss')
  })
})
