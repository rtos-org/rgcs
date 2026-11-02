import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiStatus, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { AiPanel } from './AiPanel'
import { EMPTY_CHAT, type ChatItem, type ChatState } from './chat'
import { guardAlert } from './fixtures'
import type { AiChat } from './useAiChat'

const dict = t('ja')
const at = new Date(2026, 9, 18, 12, 17).getTime()

const v = (sysid: number): VehicleState => ({
  sysid, name: `UAV-0${sysid}`, kind: 'copter', mode: 'LOITER', armed: false, lat: 0, lon: 0, alt_rel: 0, alt_msl: 0, hdg: null,
  ground_speed: 0, climb: 0, battery: { pct: 50, volt: 22, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 10, hdop: 1 }, warn: false, unread: 0,
})

const READY: AiStatus = { configured: true, provider: 'anthropic', model: 'claude-sonnet-5-5', reason: null, budget_left: null }

function fakeChat(state: Partial<ChatState> = {}, status: AiStatus | null = READY): AiChat {
  return { state: { ...EMPTY_CHAT, ...state }, status, send: vi.fn(), setProposal: vi.fn(), dismiss: vi.fn(), reset: vi.fn() }
}

function setup(chat: AiChat = fakeChat()) {
  const onTarget = vi.fn()
  const onClose = vi.fn()
  const onExecute = vi.fn()
  const view = render(<AiPanel vehicles={[v(1), v(3)]} target={3} onTarget={onTarget} chat={chat} dict={dict} onExecute={onExecute} onClose={onClose} />)
  return { chat, onTarget, onClose, onExecute, ...view }
}

const input = () => screen.getByPlaceholderText('メッセージを入力')
const sendBtn = () => screen.getByRole('button', { name: '送信' })

afterEach(() => vi.restoreAllMocks())

describe('AiPanel', () => {
  it('renders the AI panel head with the 対象 select and a close button', () => {
    const { container, onTarget, onClose } = setup()
    const aside = container.querySelector('aside.g.panel.float.float-r.ai')
    expect(aside).not.toBeNull()
    expect(aside!.querySelector('.panel-h')).toHaveTextContent('AI')
    const select = within(aside as HTMLElement).getByRole('combobox') as HTMLSelectElement
    expect(select).toHaveClass('in')
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([['1', 'UAV-01'], ['3', 'UAV-03']])
    expect(select.value).toBe('3')
    fireEvent.change(select, { target: { value: '1' } })
    expect(onTarget).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the unconfigured state and disables the input', () => {
    setup(fakeChat({}, { configured: false, provider: null, model: null, reason: 'disabled', budget_left: null }))
    expect(screen.getByText('AI チャットは未設定です。管理者がサーバーの config.toml ([ai]) を設定すると使えます。')).toBeInTheDocument()
    expect(input()).toBeDisabled()
    expect(sendBtn()).toBeDisabled()
  })

  it('shows the provider and model when configured', () => {
    const { container } = setup()
    expect(container.querySelector('.t4.ai-provider')).toHaveTextContent('anthropic · claude-sonnet-5-5')
  })

  it('sends on Enter to the target vehicle, not on Shift+Enter or empty input', () => {
    const { chat } = setup()
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(chat.send).not.toHaveBeenCalled()
    fireEvent.change(input(), { target: { value: 'text' } })
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true })
    expect(chat.send).not.toHaveBeenCalled()
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(chat.send).toHaveBeenCalledWith(3, 'text')
    expect(input()).toHaveValue('')
  })

  it('the send button sends too', () => {
    const { chat } = setup()
    fireEvent.change(input(), { target: { value: '通信状態を確認して' } })
    fireEvent.click(sendBtn())
    expect(chat.send).toHaveBeenCalledWith(3, '通信状態を確認して')
  })

  it('shows the thinking row while pending and disables send', () => {
    const { container } = setup(fakeChat({ pending: true }))
    expect(container.querySelector('.ai-list .lucide-loader-circle')).not.toBeNull()
    expect(screen.getByText('考えています…')).toBeInTheDocument()
    fireEvent.change(input(), { target: { value: 'text' } })
    expect(sendBtn()).toBeDisabled()
  })

  it('renders user, bot and error items', () => {
    const items: ChatItem[] = [
      { kind: 'user', id: 'u0', text: '通信状態を確認して', ts: at },
      { kind: 'bot', id: 'b1', text: 'UAV-03 のテレメトリ更新が遅れています。', ts: at, truncated: false },
      { kind: 'error', id: 'e2', code: 'ai_timeout', message: 'timeout', ts: at },
    ]
    const { container } = setup(fakeChat({ items }))
    const user = container.querySelector('.bubble.user')
    expect(user).toHaveTextContent('通信状態を確認して')
    expect(user!.parentElement).toHaveTextContent('12:17')
    const bots = container.querySelectorAll('.bubble.bot')
    expect(bots[0]).toHaveTextContent('UAV-03 のテレメトリ更新が遅れています。')
    expect(bots[0]!.parentElement!.querySelector('.ai-avatar .lucide-bot')).not.toBeNull()
    expect(bots[1]).toHaveClass('ai-err')
    expect(bots[1]).toHaveTextContent('AI の応答がありませんでした')
  })

  it('offers 新しい会話 when the conversation is full', () => {
    const { chat } = setup(fakeChat({ full: true }))
    expect(screen.getByText('会話が長くなりました')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '新しい会話' }))
    expect(chat.reset).toHaveBeenCalled()
  })

  it('offers 新しい会話 after any error in a running conversation, keeping the input open', () => {
    const items: ChatItem[] = [
      { kind: 'user', id: 'u0', text: 'hi', ts: at },
      { kind: 'error', id: 'e1', code: 'ai_provider_error', message: 'AI provider error (HTTP 400)', ts: at },
    ]
    const { chat } = setup(fakeChat({ conversationId: 'c1', items }))
    expect(screen.getByText('うまく続かない場合は新しい会話を始めてください')).toBeInTheDocument()
    expect(input()).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '新しい会話' }))
    expect(chat.reset).toHaveBeenCalled()
  })

  it('does not offer 新しい会話 after an error before any conversation, or once answered', () => {
    const error: ChatItem = { kind: 'error', id: 'e1', code: 'ai_timeout', message: 'x', ts: at }
    const { rerender } = setup(fakeChat({ items: [error] }))
    expect(screen.queryByRole('button', { name: '新しい会話' })).toBeNull()
    const answered: ChatItem[] = [error, { kind: 'bot', id: 'b2', text: 'ok', ts: at, truncated: false }]
    rerender(<AiPanel vehicles={[v(3)]} target={3} onTarget={() => {}} chat={fakeChat({ conversationId: 'c1', items: answered })} dict={dict} onExecute={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: '新しい会話' })).toBeNull()
  })

  it('scrolls the message list to the bottom on a new item', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(640)
    const { container, rerender } = setup()
    const items: ChatItem[] = [{ kind: 'user', id: 'u0', text: 'hi', ts: at }]
    rerender(<AiPanel vehicles={[v(3)]} target={3} onTarget={() => {}} chat={fakeChat({ items })} dict={dict} onExecute={() => {}} onClose={() => {}} />)
    expect((container.querySelector('.ai-list') as HTMLElement).scrollTop).toBe(640)
  })

  it('shows a guard alert as a local item with the shield icon and the alert text', () => {
    const alert = guardAlert({ ts: at })
    const items: ChatItem[] = [{ kind: 'guard', id: 'guard:g-1', alert, ts: at }]
    const { container, chat } = setup(fakeChat({ items }))
    const card = container.querySelector('.ai-list .inset.ai-guard')
    expect(card).not.toBeNull()
    expect(card!.querySelector('.lucide-shield-alert')).not.toBeNull()
    expect(card).toHaveTextContent('AI 緊急介入')
    expect(card).toHaveTextContent('UAV-03 トイレットボウルの兆候 — 手動で引き継いでください')
    expect(card).toHaveTextContent('12:17')
    expect(card!.querySelector('button')).toBeNull()
    expect(chat.send).not.toHaveBeenCalled()
  })
})
