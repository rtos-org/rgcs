import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VehicleCommand } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { useCommandRunner, type PickOpts, type RunnerDeps } from './useCommandRunner'

function Harness({ command, opts, deps }: { command: VehicleCommand; opts: PickOpts; deps: RunnerDeps }) {
  const runner = useCommandRunner({ entries: [], dict: t('ja'), vehicleOf: () => undefined, onError: () => {}, deps })
  return (
    <>
      <button type="button" onClick={() => runner.pick(3, command, opts)}>
        go
      </button>
      {runner.confirm}
    </>
  )
}

function setup(command: VehicleCommand, opts: PickOpts) {
  const send = vi.fn(async () => ({ id: 7 }))
  const confirm = vi.fn(async () => ({ confirm_token: 'tok', expires_in: 30 }))
  render(<Harness command={command} opts={opts} deps={{ send, confirm }} />)
  fireEvent.click(screen.getByRole('button', { name: 'go' }))
  return { send, confirm }
}

describe('useCommandRunner with an AI proposal', () => {
  it('a confirm command opens the dialog with the AI note and sends the proposal id with the token', async () => {
    const onResult = vi.fn()
    const { send } = setup({ cmd: 'arm' }, { aiProposalId: 'p-1', note: 'ready to fly', onResult })
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('AI の提案: ready to fly')
    expect(onResult).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '実行' }))
    await waitFor(() => expect(send).toHaveBeenCalledWith(3, { cmd: 'arm' }, 'tok', 'p-1'))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ kind: 'queued', id: 7 }))
  })

  it('a direct command sends the proposal id and reports the result', async () => {
    const onResult = vi.fn()
    const { send } = setup({ cmd: 'rtl' }, { aiProposalId: 'p-2', onResult })
    await waitFor(() => expect(send).toHaveBeenCalledWith(3, { cmd: 'rtl' }, undefined, 'p-2'))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ kind: 'queued', id: 7 }))
  })

  it('cancelling the confirm dialog reports needs_confirm (nothing sent)', async () => {
    const onResult = vi.fn()
    const { send } = setup({ cmd: 'arm' }, { aiProposalId: 'p-1', onResult })
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onResult).toHaveBeenCalledWith({ kind: 'needs_confirm' })
    expect(send).not.toHaveBeenCalled()
  })
})
