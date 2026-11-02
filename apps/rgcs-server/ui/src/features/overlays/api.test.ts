import { afterEach, describe, expect, it, vi } from 'vitest'
import { areasApi, listAreas, listPlugins, setPluginEnabled, tileTemplate } from './api'

const envelope = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } })
const LTE = { plugin: 'carrier', overlay: 'lte' }

describe('overlay api', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses_the_documented_paths_methods_and_bodies', async () => {
    const f = vi.fn<typeof fetch>(async () => envelope({ tiles: 12 }))
    vi.stubGlobal('fetch', f)
    const rect = { south: 33.6, west: 135.8, north: 33.7, east: 135.9 }
    const api = areasApi(LTE)
    await listPlugins()
    await setPluginEnabled('carrier', false)
    await listAreas(LTE)
    expect(await api.estimate(rect)).toBe(12)
    await api.create({ name: 'Nachi', ...rect })
    await api.refresh(3)
    await api.remove(3)
    const calls = f.mock.calls.map(([url, init]) => [String(url), init?.method ?? 'GET', typeof init?.body === 'string' ? JSON.parse(init.body) : undefined])
    const base = '/api/plugins/carrier/overlays/lte'
    expect(calls).toEqual([
      ['/api/plugins', 'GET', undefined],
      ['/api/plugins/carrier', 'PUT', { enabled: false }],
      [`${base}/areas`, 'GET', undefined],
      [`${base}/areas/estimate`, 'POST', rect],
      [`${base}/areas`, 'POST', { name: 'Nachi', ...rect }],
      [`${base}/areas/3/refresh`, 'POST', undefined],
      [`${base}/areas/3`, 'DELETE', undefined],
    ])
  })

  it('builds_the_tile_template_of_an_area_overlay', () => {
    expect(tileTemplate(LTE, 'gif', 'v9')).toBe('/api/plugins/carrier/overlays/lte/tiles/{z}/{x}/{y}.gif?v=v9')
    expect(tileTemplate({ plugin: 'a b', overlay: 'c' }, 'png', '1')).toBe('/api/plugins/a%20b/overlays/c/tiles/{z}/{x}/{y}.png?v=1')
  })

  it('reports_the_server_error_code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, error: { code: 'too_many_tiles', message: 'x' } }), { status: 400 })))
    await expect(areasApi(LTE).create({ name: 'a', south: 0, west: 0, north: 1, east: 1 })).rejects.toMatchObject({ code: 'too_many_tiles' })
  })
})
