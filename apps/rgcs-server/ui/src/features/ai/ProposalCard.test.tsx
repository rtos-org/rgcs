import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import type { ChatItem, ProposalState } from './chat'
import { proposal } from './fixtures'
import { ProposalCard } from './ProposalCard'

const dict = t('ja')
type Item = Extract<ChatItem, { kind: 'proposal' }>

function item(state: ProposalState = 'pending', over: Partial<Item> = {}): Item {
  const p = proposal()
  return { kind: 'proposal', id: p.id, proposal: p, state, ...over }
}

function setup(it: Item, now = 2_000) {
  const onExecute = vi.fn()
  const onDismiss = vi.fn()
  const view = render(<ProposalCard item={it} dict={dict} onExecute={onExecute} onDismiss={onDismiss} now={now} />)
  return { onExecute, onDismiss, ...view }
}

describe('ProposalCard', () => {
  it('shows the AI label, the command, the target, the reason and 実行 / 却下', () => {
    const { container, onDismiss } = setup(item())
    expect(container.querySelector('.ai-proposal .lucide-sparkles')).not.toBeNull()
    expect(container).toHaveTextContent('AI の提案')
    expect(container).toHaveTextContent('モード変更 → LOITER')
    expect(container).toHaveTextContent('対象: UAV-03')
    expect(container).toHaveTextContent('hold position')
    expect(screen.getByRole('button', { name: '実行' })).toHaveClass('btn-primary')
    fireEvent.click(screen.getByRole('button', { name: '却下' }))
    expect(onDismiss).toHaveBeenCalledWith('p-1')
  })

  it('uses the danger button for a destructive command', () => {
    const p = proposal({ command: { cmd: 'arm' }, requires_confirm: true })
    setup(item('pending', { proposal: p }))
    expect(screen.getByRole('button', { name: '実行' })).toHaveClass('btn-danger')
  })

  it('実行 calls onExecute once with the proposal', () => {
    const { onExecute } = setup(item())
    fireEvent.click(screen.getByRole('button', { name: '実行' }))
    expect(onExecute).toHaveBeenCalledTimes(1)
    expect(onExecute).toHaveBeenCalledWith(proposal())
  })

  it('disables both buttons while sending', () => {
    setup(item('sending'))
    expect(screen.getByRole('button', { name: '実行' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '却下' })).toBeDisabled()
  })

  it('an executed or dismissed proposal shows a status line and no buttons', () => {
    const { unmount } = setup(item('executed'))
    expect(screen.getByText('実行しました')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    unmount()
    setup(item('dismissed'))
    expect(screen.getByText('却下しました')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('a proposal past its expiry shows 期限切れ and no 実行', () => {
    setup(item(), 200_000)
    expect(screen.getByText('期限切れ')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '実行' })).toBeNull()
  })

  it('a failed proposal shows the error and can be tried again', () => {
    setup(item('failed', { error: 'リンク断' }))
    expect(screen.getByText('リンク断')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '実行' })).toBeEnabled()
  })
})
