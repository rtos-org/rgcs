import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PluginInfo } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { OverlayMenuSection } from './OverlayMenuSection'
import { PluginsStore } from './plugins'
import { OverlayPrefsStore, prefsFor } from './prefs'
import { overlay, plugin, seaMarks } from './testData'

const memory = () => {
  const items: Record<string, string> = {}
  return { getItem: (k: string) => items[k] ?? null, setItem: (k: string, v: string) => void (items[k] = v) }
}

function show(list: PluginInfo[], lang: 'ja' | 'en' = 'ja') {
  const prefs = new OverlayPrefsStore(memory())
  const onManage = vi.fn()
  const r = render(<OverlayMenuSection dict={t(lang)} prefs={prefs} plugins={new PluginsStore(async () => list)} onManage={onManage} />)
  return { prefs, onManage, ...r }
}

describe('OverlayMenuSection', () => {
  it('switches_an_overlay_and_sets_its_opacity_once_on', async () => {
    const { prefs } = show([plugin()])
    const item = await screen.findByRole('menuitemcheckbox', { name: 'LTE エリア' })
    expect(screen.getByRole('group', { name: 'オーバーレイ' })).toBeInTheDocument()
    expect(item).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('slider')).toBeNull()
    fireEvent.click(item)
    expect(prefsFor(prefs.getState(), 'carrier/lte', 60).on).toBe(true)
    const slider = screen.getByRole('slider', { name: 'LTE エリア 透明度' })
    expect(slider).toHaveAttribute('min', '10')
    expect(slider).toHaveValue('60')
    fireEvent.change(slider, { target: { value: '25' } })
    expect(prefsFor(prefs.getState(), 'carrier/lte', 60).opacity).toBe(25)
    expect(screen.getByText('25%')).toBeInTheDocument()
  })

  it('opens_the_area_sheet_of_an_area_overlay_only', async () => {
    const { onManage } = show([plugin(), seaMarks()])
    fireEvent.click(await screen.findByRole('menuitem', { name: 'LTE エリア: 範囲を管理…' }))
    expect(onManage).toHaveBeenCalledWith(expect.objectContaining({ key: 'carrier/lte' }))
    expect(screen.getByRole('menuitemcheckbox', { name: '海図標識' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /海図標識: / })).toBeNull()
  })

  it('shows_the_legend_while_on_and_falls_back_to_english', async () => {
    show([plugin({ overlays: [overlay({ legend: [{ color: '#ff7f00', label: { en: 'LTE 4G' } }] })] })], 'en')
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'LTE area' }))
    const legend = screen.getByRole('list', { name: 'LTE area' })
    expect(legend).toHaveTextContent('LTE 4G')
  })

  it('lists_plugin_links_under_the_plugin_name_in_a_new_tab', async () => {
    show([seaMarks()])
    const link = await screen.findByRole('menuitem', { name: '海図' })
    expect(link).toHaveAttribute('href', 'https://chart.example.org/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByRole('group', { name: 'Sea marks' })).toBeInTheDocument()
  })

  it('renders_nothing_without_plugins_or_with_only_disabled_ones', async () => {
    const { container } = show([plugin({ enabled: false })])
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
