import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AiToolRun } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { ToolCard } from './ToolCard'

const dict = t('ja')
const names = new Map([[3, 'UAV-03']])
const at = new Date(2026, 9, 18, 12, 17).getTime()
const runs: AiToolRun[] = [
  { tool: 'get_vehicle_status', sysid: 3, ok: true, error: null, ts: at },
  { tool: 'search_log', sysid: null, ok: false, error: 'invalid', ts: at },
]

describe('ToolCard', () => {
  it('shows the last status as a kv grid: 最終受信 and 映像', () => {
    const { container } = render(<ToolCard card={{ sysid: 3, name: 'UAV-03', last_rx_age_ms: 1800, video: 'live' }} runs={runs} names={names} dict={dict} />)
    const kv = container.querySelector('.ai-kv')
    expect(kv).not.toBeNull()
    expect(kv).toHaveTextContent('最終受信1.8 秒前')
    expect(kv).toHaveTextContent('映像受信中')
    expect(screen.getByText('ツール実行履歴')).toBeInTheDocument()
  })

  it('lists every tool run with its result icon, label, time and target', () => {
    const { container } = render(<ToolCard card={null} runs={runs} names={names} dict={dict} />)
    const rows = container.querySelectorAll('.ai-run')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.querySelector('.ok .lucide-circle-check')).not.toBeNull()
    expect(rows[0]).toHaveTextContent('状態取得・完了')
    expect(rows[0]).toHaveTextContent('12:17')
    expect(rows[0]).toHaveTextContent('対象: UAV-03')
    expect(rows[1]!.querySelector('.bad .lucide-octagon-x')).not.toBeNull()
    expect(rows[1]).toHaveTextContent('ログ検索・失敗')
    expect(rows[1]).not.toHaveTextContent('対象')
  })

  it('has no kv grid without a status card', () => {
    const { container } = render(<ToolCard card={null} runs={runs} names={names} dict={dict} />)
    expect(container.querySelector('.ai-kv')).toBeNull()
  })
})
