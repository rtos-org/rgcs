import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PluginInfo } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { PluginsStore } from '../overlays/plugins'
import { plugin, seaMarks } from '../overlays/testData'
import { PluginsCard } from './PluginsCard'

const broken = plugin({ id: 'bad', status: 'error', error: 'id_mismatch', version: '', name: { en: 'bad' }, overlays: [] })

function show(list: () => PluginInfo[], isAdmin = true, setEnabled = vi.fn(async () => ({}))) {
  const load = vi.fn(async () => list())
  render(<PluginsCard dict={t('ja')} isAdmin={isAdmin} store={new PluginsStore(load)} setEnabled={setEnabled} />)
  return { load, setEnabled }
}

describe('PluginsCard', () => {
  it('lists_each_plugin_with_its_version_counts_and_author', async () => {
    show(() => [plugin({ author: 'RtoS' }), seaMarks()])
    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('キャリア')
    expect(rows[0]).toHaveTextContent('carrier 1.0')
    expect(rows[0]).toHaveTextContent('オーバーレイ 1・リンク 0')
    expect(rows[0]).toHaveTextContent('作成: RtoS')
    expect(rows[1]).toHaveTextContent('オーバーレイ 1・リンク 1')
  })

  it('says_why_a_broken_plugin_did_not_load', async () => {
    show(() => [broken])
    const row = await screen.findByRole('listitem')
    expect(row).toHaveTextContent('読み込めません: id とフォルダ名が違います')
    expect(row).not.toHaveTextContent('オーバーレイ')
  })

  it('an_admin_switches_a_plugin_and_the_list_is_read_again', async () => {
    let on = true
    const { load, setEnabled } = show(() => [plugin({ enabled: on })])
    const sw = await screen.findByRole('switch', { name: 'キャリア' })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    on = false
    fireEvent.click(sw)
    expect(setEnabled).toHaveBeenCalledWith('carrier', false)
    await waitFor(() => expect(screen.getByRole('switch', { name: 'キャリア' })).toHaveAttribute('aria-checked', 'false'))
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('a_failed_switch_says_so', async () => {
    show(() => [plugin()], true, vi.fn(async () => Promise.reject(new Error('403'))))
    fireEvent.click(await screen.findByRole('switch', { name: 'キャリア' }))
    expect(await screen.findByText('失敗')).toBeInTheDocument()
  })

  it('is_read_only_for_operators', async () => {
    show(() => [plugin()], false)
    expect(await screen.findByRole('switch', { name: 'キャリア' })).toBeDisabled()
    expect(screen.getByText('プラグインの切り替えは管理者だけです')).toBeInTheDocument()
  })

  it('says_when_none_is_installed', async () => {
    show(() => [])
    expect(await screen.findByText('プラグインはありません')).toBeInTheDocument()
    expect(within(screen.getByTestId('plugins-card')).getByText(/PLUGINS.md/)).toBeInTheDocument()
  })
})
