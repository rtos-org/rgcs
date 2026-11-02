import { describe, expect, it } from 'vitest'
import { t } from '../../shared/i18n'
import { ageText, aiErrorText, proposalText, toolLabel } from './format'
import { proposal } from './fixtures'

const ja = t('ja')
const en = t('en')

describe('ai format', () => {
  it('ageText shows seconds with one decimal, then whole minutes', () => {
    expect(ageText(1800, ja)).toBe('1.8 秒前')
    expect(ageText(1800, en)).toBe('1.8 s ago')
    expect(ageText(65_000, ja)).toBe('1 分前')
    expect(ageText(65_000, en)).toBe('1 min ago')
    expect(ageText(0, ja)).toBe('0.0 秒前')
    expect(ageText(null, ja)).toBe('—')
  })

  it('toolLabel names the tool and its outcome', () => {
    expect(toolLabel('get_vehicle_status', true, ja)).toBe('状態取得・完了')
    expect(toolLabel('search_log', false, ja)).toBe('ログ検索・失敗')
    expect(toolLabel('list_vehicles', true, en)).toBe('Vehicle list · done')
    expect(toolLabel('mystery', true, ja)).toBe('mystery・完了')
    expect(toolLabel('list_guard_alerts', true, ja)).toBe('AI 緊急介入の警告取得・完了')
    expect(toolLabel('get_external_factors', true, en)).toBe('External factors · done')
  })

  it('proposalText labels the command and its argument', () => {
    expect(proposalText(proposal(), ja)).toBe('モード変更 → LOITER')
    expect(proposalText(proposal({ command: { cmd: 'takeoff', args: { alt_rel: 30 } } }), ja)).toBe('離陸 → 30 m')
    expect(proposalText(proposal({ command: { cmd: 'change_speed', args: { mps: 12.5 } } }), ja)).toBe('速度変更 → 12.5 m/s')
    expect(proposalText(proposal({ command: { cmd: 'rtl' } }), ja)).toBe('帰還')
  })

  it('aiErrorText maps server codes to the panel strings', () => {
    expect(aiErrorText('ai_timeout', 'x', ja)).toBe('AI の応答がありませんでした')
    expect(aiErrorText('ai_refused', 'x', ja)).toBe('AI が応答を拒否しました')
    expect(aiErrorText('ai_provider_error', 'x', ja)).toBe('AI に接続できません')
    expect(aiErrorText('ai_busy', 'x', ja)).toBe('前の質問に回答中です')
    expect(aiErrorText('rate_limited', 'x', ja)).toBe('しばらく待ってから送信してください')
    expect(aiErrorText('rate_limited', 'x', ja, 12)).toBe('12 秒後に送信できます')
    expect(aiErrorText('conversation_full', 'x', ja)).toBe('会話が長くなりました')
    expect(aiErrorText('something_else', 'raw text', ja)).toBe('raw text')
  })
})
