import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../shared/i18n'
import { Nav } from './Nav'

describe('Nav', () => {
  it('renders_the_six_views_in_spec_order', () => {
    const { container } = render(<Nav view="ops" onView={() => {}} dict={t('ja')} />)
    expect(container.querySelector('nav.seg.n6')).not.toBeNull()
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['運用マップ', '全機体映像', 'フライトプラン', 'ネットワーク', 'AIチャット', 'メンテナンス・設定'])
    for (const b of buttons) expect(b.querySelector('svg.lucide, svg.ic')).not.toBeNull()
    expect(buttons[0]).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('lens')).toHaveStyle({ transform: 'translateX(0%)' })
  })

  it('ai_chat_is_enabled_and_moves_the_lens', () => {
    const onView = vi.fn()
    render(<Nav view="ops" onView={onView} dict={t('ja')} />)
    const ai = screen.getAllByRole('button')[4]!
    expect(ai).toHaveAccessibleName('AIチャット')
    expect(ai).not.toHaveAttribute('aria-disabled')
    expect(ai).toHaveAttribute('title', 'AIチャット')
    fireEvent.click(ai)
    expect(onView).toHaveBeenCalledWith('ai')
  })

  it('with view ai the lens sits on the fifth button', () => {
    render(<Nav view="ai" onView={() => {}} dict={t('ja')} />)
    expect(screen.getByTestId('lens')).toHaveStyle({ transform: 'translateX(400%)' })
    expect(screen.getByRole('button', { name: 'AIチャット' })).toHaveAttribute('aria-current', 'page')
  })

  it('mission and video tabs are enabled', () => {
    const onView = vi.fn()
    render(<Nav view="ops" onView={onView} dict={t('ja')} />)
    for (const [name, view] of [['フライトプラン', 'mission'], ['全機体映像', 'video']] as const) {
      const b = screen.getByRole('button', { name })
      expect(b).not.toHaveAttribute('aria-disabled')
      fireEvent.click(b)
      expect(onView).toHaveBeenCalledWith(view)
    }
  })

  it('network_is_enabled', () => {
    const onView = vi.fn()
    render(<Nav view="ops" onView={onView} dict={t('ja')} />)
    const net = screen.getByRole('button', { name: 'ネットワーク' })
    expect(net).not.toHaveAttribute('aria-disabled')
    fireEvent.click(net)
    expect(onView).toHaveBeenCalledWith('network')
  })
})
