import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { OverlayArea, PluginInfo } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { AreasHub } from './areasHub'
import { OverlayNotice } from './OverlayNotice'
import { PluginsStore } from './plugins'
import { OverlayPrefsStore } from './prefs'
import { area, overlay, plugin, seaMarks } from './testData'

const memory = () => {
  const items: Record<string, string> = {}
  return { getItem: (k: string) => items[k] ?? null, setItem: (k: string, v: string) => void (items[k] = v) }
}

function show(on: string[], areas: OverlayArea[] = [area()], list: PluginInfo[] = [plugin(), seaMarks()], lang: 'ja' | 'en' = 'ja') {
  const prefs = new OverlayPrefsStore(memory())
  act(() => on.forEach((k) => prefs.toggle(k, 60)))
  return render(<OverlayNotice dict={t(lang)} stores={{ prefs, areas: new AreasHub(async () => areas), plugins: new PluginsStore(async () => list) }} />)
}

describe('OverlayNotice', () => {
  it('shows_nothing_while_every_overlay_is_off', async () => {
    const { container } = show([])
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })

  it('carries_the_plugin_notice_with_the_newest_dates', async () => {
    show(['carrier/lte'])
    await waitFor(() => expect(screen.getByRole('note')).toHaveTextContent('上空通信の保証なし(取得 2026-10-31・データ 2026-10-01)'))
  })

  it('reads_in_english_with_the_english_notice', async () => {
    show(['carrier/lte'], [area()], [plugin()], 'en')
    await waitFor(() => expect(screen.getByRole('note')).toHaveTextContent('No guarantee in the air (fetched 2026-10-31, data 2026-10-01)'))
  })

  it('says_no_area_is_fetched_yet_and_unknown_data_dates', async () => {
    show(['carrier/lte'], [])
    await waitFor(() => expect(screen.getByRole('note')).toHaveTextContent('LTE エリア: 範囲未取得'))
  })

  it('an_unknown_data_date_reads_unknown', async () => {
    show(['carrier/lte'], [area({ data_modified: null })])
    await waitFor(() => expect(screen.getByRole('note')).toHaveTextContent('データ 不明'))
  })

  it('stacks_one_line_per_overlay_and_skips_a_direct_overlay_without_notice', async () => {
    const sea = seaMarks()
    const withNotice = { ...sea, overlays: [overlay({ ...sea.overlays[0]!, notice: { en: 'Not for navigation', ja: '航海用ではありません' } })] }
    show(['carrier/lte', 'sea/marks'], [area()], [plugin(), withNotice])
    await waitFor(() => expect(screen.getAllByRole('note')).toHaveLength(2))
    expect(screen.getAllByRole('note')[1]).toHaveTextContent('航海用ではありません')
    const { container } = show(['sea/marks'], [], [seaMarks()])
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })
})
