import { describe, expect, it, vi } from 'vitest'
import { proposal } from '../features/ai/fixtures'
import { t } from '../shared/i18n'
import { executeProposal, proposalOutcome } from './aiExecute'

const dict = t('ja')

describe('proposalOutcome', () => {
  it('maps a queued send to executed', () => {
    expect(proposalOutcome({ kind: 'queued', id: 4 }, dict)).toEqual({ state: 'executed' })
  })
  it('maps a cancelled confirm back to pending', () => {
    expect(proposalOutcome({ kind: 'needs_confirm' }, dict)).toEqual({ state: 'pending' })
  })
  it('maps proposal_expired to expired', () => {
    expect(proposalOutcome({ kind: 'error', code: 'proposal_expired', message: 'x' }, dict)).toEqual({ state: 'expired' })
  })
  it('maps other errors to failed with the command error text', () => {
    const out = proposalOutcome({ kind: 'error', code: 'nope', message: 'vehicle said no' }, dict)
    expect(out.state).toBe('failed')
    expect(out.error).toContain('vehicle said no')
  })
})

describe('executeProposal', () => {
  it('marks the card sending and picks the command with the proposal id and reason', () => {
    const setProposal = vi.fn()
    const pick = vi.fn()
    const p = proposal()
    executeProposal({ setProposal }, { pick }, dict)(p)
    expect(setProposal).toHaveBeenCalledWith('p-1', 'sending')
    expect(pick).toHaveBeenCalledWith(3, p.command, expect.objectContaining({ aiProposalId: 'p-1', note: 'hold position' }))
    pick.mock.calls[0]![2].onResult({ kind: 'queued', id: 1 })
    expect(setProposal).toHaveBeenLastCalledWith('p-1', 'executed')
    pick.mock.calls[0]![2].onResult({ kind: 'error', code: 'link_lost', message: 'm' })
    expect(setProposal).toHaveBeenLastCalledWith('p-1', 'failed', expect.any(String))
  })
})
