import { describe, expect, it, vi } from 'vitest'
import { activeLinks, activeOverlays, pickText, PluginsStore } from './plugins'
import { overlay, plugin, seaMarks } from './testData'

describe('plugin text', () => {
  it('picks_the_language_then_english', () => {
    const t = { en: 'Sea', ja: '海' }
    expect(pickText(t, 'ja')).toBe('海')
    expect(pickText(t, 'ko')).toBe('Sea')
    expect(pickText(null, 'ja')).toBe('')
  })
})

describe('active overlays and links', () => {
  it('come_from_loaded_enabled_plugins_in_list_order', () => {
    const broken = plugin({ id: 'bad', status: 'error', error: 'parse', overlays: [overlay({ id: 'x' })] })
    const off = plugin({ id: 'off', enabled: false, overlays: [overlay({ id: 'y' })], links: [{ label: { en: 'L' }, url: 'https://l.example/' }] })
    const list = [broken, plugin(), off, seaMarks()]
    expect(activeOverlays(list).map((o) => o.key)).toEqual(['carrier/lte', 'sea/marks'])
    expect(activeOverlays(list)[1]).toMatchObject({ ref: { plugin: 'sea', overlay: 'marks' }, plugin: { id: 'sea' }, overlay: { cache: 'direct' } })
    expect(activeLinks(list).map((p) => p.id)).toEqual(['sea'])
  })
})

describe('plugins store', () => {
  it('loads_once_on_demand_and_reloads_on_request', async () => {
    const load = vi.fn(async () => [plugin()])
    const s = new PluginsStore(load)
    s.ensureLoaded()
    s.ensureLoaded()
    await vi.waitFor(() => expect(s.getState().loaded).toBe(true))
    expect(load).toHaveBeenCalledTimes(1)
    expect(s.getState().plugins).toEqual([plugin()])
    await s.reload()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('a_failed_load_keeps_the_last_list_and_flags_the_error', async () => {
    const load = vi.fn().mockResolvedValueOnce([plugin()]).mockRejectedValueOnce(new Error('down'))
    const s = new PluginsStore(load)
    await s.reload()
    await s.reload()
    expect(s.getState()).toMatchObject({ plugins: [plugin()], error: true, loaded: true })
  })
})
