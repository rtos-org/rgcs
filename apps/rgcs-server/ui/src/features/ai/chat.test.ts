import { describe, expect, it } from 'vitest'
import { chatReducer, EMPTY_CHAT, withGuardAlert, type ChatState } from './chat'
import { guardAlert, proposal, reply } from './fixtures'

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null) {
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k])
    Object.freeze(v)
  }
  return v
}

const sent = (): ChatState => chatReducer(EMPTY_CHAT, { t: 'send', text: 'status?', ts: 100 })

describe('chatReducer', () => {
  it('send appends a user item and sets pending', () => {
    const s = sent()
    expect(s.pending).toBe(true)
    expect(s.items).toEqual([{ kind: 'user', id: expect.any(String), text: 'status?', ts: 100 }])
  })

  it('reply appends bot, tool and proposal items in order and clears pending', () => {
    const runs = [{ tool: 'get_vehicle_status', sysid: 3, ok: true, error: null, ts: 1_500 }]
    const card = { sysid: 3, name: 'UAV-03', last_rx_age_ms: 1800, video: 'live' as const }
    const s = chatReducer(sent(), { t: 'reply', reply: reply({ tool_runs: runs, status_card: card, proposals: [proposal(), proposal({ id: 'p-2' })], truncated: true }) })
    expect(s.pending).toBe(false)
    expect(s.conversationId).toBe('c-1')
    expect(s.items.map((i) => i.kind)).toEqual(['user', 'bot', 'tool', 'proposal', 'proposal'])
    expect(s.items[1]).toMatchObject({ kind: 'bot', text: 'UAV-03 is flying', ts: 2_000, truncated: true })
    expect(s.items[2]).toMatchObject({ kind: 'tool', card, runs })
    expect(s.items[3]).toMatchObject({ kind: 'proposal', id: 'p-1', state: 'pending' })
    expect(new Set(s.items.map((i) => i.id)).size).toBe(5)
  })

  it('a reply without tool runs has no tool item', () => {
    const s = chatReducer(sent(), { t: 'reply', reply: reply() })
    expect(s.items.map((i) => i.kind)).toEqual(['user', 'bot'])
  })

  it('fail appends an error item; conversation_full sets full', () => {
    const s = chatReducer(sent(), { t: 'fail', code: 'ai_timeout', message: 'late', ts: 300 })
    expect(s.pending).toBe(false)
    expect(s.full).toBe(false)
    expect(s.items[1]).toMatchObject({ kind: 'error', code: 'ai_timeout', message: 'late', ts: 300 })
    const full = chatReducer(sent(), { t: 'fail', code: 'conversation_full', message: 'full', ts: 300 })
    expect(full.full).toBe(true)
  })

  it('fail keeps the retry delay of a rate limit', () => {
    const s = chatReducer(sent(), { t: 'fail', code: 'rate_limited', message: 'slow down', ts: 300, retryAfterS: 12 })
    expect(s.items[1]).toMatchObject({ kind: 'error', code: 'rate_limited', retryAfterS: 12 })
  })

  it('reset returns the empty chat', () => {
    expect(chatReducer(sent(), { t: 'reset' })).toBe(EMPTY_CHAT)
  })

  it('proposal changes only the matching item', () => {
    const s = chatReducer(sent(), { t: 'reply', reply: reply({ proposals: [proposal(), proposal({ id: 'p-2' })] }) })
    const next = chatReducer(s, { t: 'proposal', id: 'p-2', state: 'failed', error: 'link lost' })
    expect(next.items[2]).toBe(s.items[2])
    expect(next.items[3]).toMatchObject({ id: 'p-2', state: 'failed', error: 'link lost' })
    expect(chatReducer(s, { t: 'proposal', id: 'p-9', state: 'executed' }).items).toEqual(s.items)
  })

  it('never mutates its input', () => {
    const base = deepFreeze(chatReducer(sent(), { t: 'reply', reply: reply({ proposals: [proposal()] }) }))
    const snapshot = JSON.stringify(base)
    const actions = [
      { t: 'send', text: 'again', ts: 400 },
      { t: 'reply', reply: reply({ conversation_id: 'c-2' }) },
      { t: 'fail', code: 'ai_busy', message: 'busy', ts: 500 },
      { t: 'proposal', id: 'p-1', state: 'sending' },
      { t: 'guard', alert: guardAlert() },
      { t: 'reset' },
    ] as const
    for (const a of actions) {
      const next = chatReducer(base, a)
      expect(next).not.toBe(base)
      if (a.t !== 'reset') expect(next.items).not.toBe(base.items)
    }
    expect(JSON.stringify(base)).toBe(snapshot)
  })
})

describe('withGuardAlert', () => {
  it('adds one guard item per alert id and updates it in place by id', () => {
    const one = withGuardAlert(sent().items, guardAlert())
    expect(one.map((i) => i.kind)).toEqual(['user', 'guard'])
    expect(one[1]).toMatchObject({ kind: 'guard', alert: { id: 'g-1', phase: 'alerting' }, ts: 3_000 })
    const before = one[1]
    const updated = withGuardAlert(one, guardAlert({ phase: 'countdown', text: '5 秒後に ALT_HOLD へ切り替えます', ts: 4_000 }))
    expect(updated).not.toBe(one)
    expect(updated).toHaveLength(2)
    expect(updated[1]).toMatchObject({ kind: 'guard', alert: { phase: 'countdown' }, ts: 4_000 })
    expect(updated[0]).toBe(one[0])
    expect(before).toMatchObject({ alert: { phase: 'alerting' } })
    const other = withGuardAlert(updated, guardAlert({ id: 'g-2', sysid: 4 }))
    expect(other.map((i) => i.kind)).toEqual(['user', 'guard', 'guard'])
    expect(new Set(other.map((i) => i.id)).size).toBe(3)
  })

  it('the guard action keeps pending and the conversation as they are', () => {
    const s = chatReducer(sent(), { t: 'guard', alert: guardAlert() })
    expect(s.pending).toBe(true)
    expect(s.conversationId).toBeNull()
    expect(s.items).toHaveLength(2)
  })
})
