import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GuardSettings } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { GuardSettingsSheet } from './GuardSettingsSheet'

const T1 = 'テレメトリの常時監視: 接続中の全機体のテレメトリを AI が常時読み、判断に使います(外部 LLM を使う設定では、その要約が外部へ送られます)'
const T2 = '外部データの取得: 飛行場所の概略位置(0.01° に丸め)を天気・宇宙天気などの外部サービスへ送って情報を得ます'
const T3 = '自動操作のリスク: L2 / L3 に設定した事象では AI が機体を操作します'

const off: GuardSettings = {
  enabled: false,
  consent: { monitoring: false, external_data: false, auto_ops: false, by: null, at_ms: null },
  toilet_bowl: 'l1',
  countdown_s: 5,
  takeover_wait_s: 20,
  params: null,
}
const on: GuardSettings = { ...off, enabled: true, consent: { monitoring: true, external_data: true, auto_ops: false, by: 'admin', at_ms: 1_761_400_000_000 } }

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const ok = (data: unknown) => reply(200, { success: true, data })

interface Rig {
  readonly puts: unknown[]
}

function rig(initial: GuardSettings, putReply?: (body: Record<string, unknown>) => Response): Rig {
  const puts: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url === '/api/guard/settings' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        puts.push(body)
        if (putReply) return putReply(body)
        return ok({ ...initial, ...body, consent: body.consent ? { ...initial.consent, ...(body.consent as object) } : initial.consent })
      }
      if (url === '/api/guard/settings') return ok(initial)
      return reply(404, { success: false, error: { code: 'not_found', message: url } })
    }),
  )
  return { puts }
}

const show = (isAdmin = true) => render(<GuardSettingsSheet isAdmin={isAdmin} dict={t('ja')} onClose={() => {}} />)

describe('GuardSettingsSheet', () => {
  const confirmSpy = vi.fn(() => true)
  beforeEach(() => {
    confirmSpy.mockClear()
    vi.stubGlobal('confirm', confirmSpy)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('disabled_shows_the_state_and_an_enable_button_for_admins', async () => {
    rig(off)
    show()
    expect(await screen.findByText('AI 緊急介入(実験機能)')).toBeInTheDocument()
    expect(await screen.findByTestId('guard-state')).toHaveTextContent('オフ')
    expect(screen.getByRole('button', { name: '有効にする' })).toBeEnabled()
  })

  it('an_operator_sees_the_state_and_no_buttons', async () => {
    rig(off)
    show(false)
    expect(await screen.findByTestId('guard-state')).toHaveTextContent('オフ')
    expect(screen.queryByRole('button', { name: '有効にする' })).toBeNull()
    expect(screen.getByText('管理者のみ変更できます')).toBeInTheDocument()
  })

  it('enable_opens_the_in_app_consent_dialog_with_three_separate_unchecked_boxes', async () => {
    rig(off)
    show()
    fireEvent.click(await screen.findByRole('button', { name: '有効にする' }))
    const dialog = await screen.findByRole('dialog', { name: 'AI 緊急介入を有効にする' })
    expect(dialog.closest('.modal-backdrop')).not.toBeNull()
    for (const text of [T1, T2, T3]) expect(within(dialog).getByRole('checkbox', { name: text })).not.toBeChecked()
    expect(within(dialog).getByText(/管理者だけ/)).toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('the_confirm_button_waits_for_box_1_and_submits_the_ticked_boxes', async () => {
    const { puts } = rig(off)
    show()
    fireEvent.click(await screen.findByRole('button', { name: '有効にする' }))
    const dialog = await screen.findByRole('dialog', { name: 'AI 緊急介入を有効にする' })
    const go = within(dialog).getByRole('button', { name: '同意して有効にする' })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: T2 }))
    expect(go).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: T1 }))
    expect(go).toBeEnabled()
    fireEvent.click(go)
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toEqual({ enabled: true, consent: { monitoring: true, external_data: true, auto_ops: false } })
    expect(await screen.findByTestId('guard-state')).toHaveTextContent('オン')
    expect(screen.queryByRole('dialog', { name: 'AI 緊急介入を有効にする' })).toBeNull()
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('cancel_closes_the_dialog_without_a_request', async () => {
    const { puts } = rig(off)
    show()
    fireEvent.click(await screen.findByRole('button', { name: '有効にする' }))
    const dialog = await screen.findByRole('dialog', { name: 'AI 緊急介入を有効にする' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('dialog', { name: 'AI 緊急介入を有効にする' })).toBeNull()
    expect(puts).toHaveLength(0)
  })

  it('enabled_level_select_offers_l0_to_l3_and_locks_l2_l3_without_auto_ops', async () => {
    const { puts } = rig(on)
    show()
    const group = await screen.findByRole('group', { name: 'トイレットボウル' })
    const names = within(group).getAllByRole('button').map((b) => b.textContent)
    expect(names).toEqual(['L0', 'L1', 'L2', 'L3'])
    expect(within(group).getByRole('button', { name: 'L1' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: 'L2' })).toBeDisabled()
    expect(within(group).getByRole('button', { name: 'L3' })).toBeDisabled()
    expect(screen.getByText('自動操作の同意が必要です')).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('button', { name: 'L0' }))
    await waitFor(() => expect(puts).toEqual([{ toilet_bowl: 'l0' }]))
  })

  it('l2_and_l3_are_selectable_with_auto_ops_consent', async () => {
    const { puts } = rig({ ...on, consent: { ...on.consent, auto_ops: true } })
    show()
    const group = await screen.findByRole('group', { name: 'トイレットボウル' })
    expect(within(group).getByRole('button', { name: 'L2' })).toBeEnabled()
    expect(screen.queryByText('自動操作の同意が必要です')).toBeNull()
    fireEvent.click(within(group).getByRole('button', { name: 'L2' }))
    await waitFor(() => expect(puts).toEqual([{ toilet_bowl: 'l2' }]))
  })

  it('countdown_and_wait_reject_out_of_range_values_before_any_request', async () => {
    const { puts } = rig(on)
    show()
    const countdown = await screen.findByLabelText('カウントダウン (秒)')
    const wait = screen.getByLabelText('引き継ぎ待ち (秒)')
    const save = screen.getByRole('button', { name: '時間を保存' })
    fireEvent.change(countdown, { target: { value: '2' } })
    fireEvent.click(save)
    expect(await screen.findByText('カウントダウンは 3〜15 秒です')).toBeInTheDocument()
    fireEvent.change(countdown, { target: { value: '8' } })
    fireEvent.change(wait, { target: { value: '121' } })
    fireEvent.click(save)
    expect(await screen.findByText('引き継ぎ待ちは 10〜120 秒です')).toBeInTheDocument()
    expect(puts).toHaveLength(0)
    fireEvent.change(wait, { target: { value: '30' } })
    fireEvent.click(save)
    await waitFor(() => expect(puts).toEqual([{ countdown_s: 8, takeover_wait_s: 30 }]))
  })

  it('a_server_refusal_shows_its_message', async () => {
    rig({ ...on, consent: { ...on.consent, auto_ops: true } }, () =>
      reply(400, { success: false, error: { code: 'auto_ops_consent_required', message: 'L2 / L3 need consent 3 (automatic operation)' } }),
    )
    show()
    const group = await screen.findByRole('group', { name: 'トイレットボウル' })
    fireEvent.click(within(group).getByRole('button', { name: 'L3' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('L2 / L3 には自動操作の同意が必要です')
  })

  it('disable_asks_in_an_in_app_row_then_sends_enabled_false', async () => {
    const { puts } = rig(on)
    show()
    fireEvent.click(await screen.findByRole('button', { name: '無効にする' }))
    const row = await screen.findByTestId('guard-disable-confirm')
    expect(row).toHaveTextContent('3 つの同意も取り消されます')
    expect(puts).toHaveLength(0)
    fireEvent.click(within(row).getByRole('button', { name: '無効にする' }))
    await waitFor(() => expect(puts).toEqual([{ enabled: false }]))
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})
