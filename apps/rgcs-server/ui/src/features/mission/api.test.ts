import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mission } from '../../shared/api/types'
import { createMission, downloadMission, readFence, readFenceParams, readRally, setFenceAltMax, writeFence, writeRally, exportWaypoints, getKnownMission, importWaypoints, listMissions, updateMission, uploadMission, uploadSavedMission, validateMission } from './api'

const mission: Mission = { id: null, name: 'm', sysid: null, default_alt: 50, default_frame: 'rel', speed: 8, home: null, fence: [], rally: [], surveys: [], items: [] }

function stub(responder: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => responder(String(input), init))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const envelope = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status, headers: { 'content-type': 'application/json' } })

describe('mission api', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the documented paths, methods and bodies', async () => {
    const f = stub(() => envelope([]))
    await listMissions()
    await createMission(mission)
    await updateMission(3, mission)
    await uploadMission(1, mission)
    await uploadSavedMission(1, 7)
    await downloadMission(2)
    await validateMission(mission, 1)
    await validateMission(mission, null)
    await getKnownMission(4)
    const calls = f.mock.calls.map(([url, init]) => [String(url), init?.method ?? 'GET', typeof init?.body === 'string' ? JSON.parse(init.body) : undefined])
    expect(calls).toEqual([
      ['/api/missions', 'GET', undefined],
      ['/api/missions', 'POST', mission],
      ['/api/missions/3', 'PUT', mission],
      ['/api/vehicles/1/mission', 'PUT', mission],
      ['/api/vehicles/1/mission/upload', 'POST', { mission_id: 7 }],
      ['/api/vehicles/2/mission', 'GET', undefined],
      ['/api/missions/validate?sysid=1', 'POST', mission],
      ['/api/missions/validate', 'POST', mission],
      ['/api/vehicles/4/mission/known', 'GET', undefined],
    ])
  })

  it('fence and rally have their own vehicle endpoints', async () => {
    const f = stub(() => envelope({ zones: [], points: [] }))
    const zones = [{ kind: 'circle' as const, inclusion: true, center: { lat: 36, lon: 137 }, radius: 100 }]
    const points = [{ lat: 36, lon: 137, alt: 60 }]
    await writeFence(1, zones)
    await readFence(1)
    await writeRally(2, points)
    await readRally(2)
    const calls = f.mock.calls.map(([url, init]) => [String(url), init?.method ?? 'GET', typeof init?.body === 'string' ? JSON.parse(init.body) : undefined])
    expect(calls).toEqual([
      ['/api/vehicles/1/fence', 'PUT', { zones }],
      ['/api/vehicles/1/fence', 'GET', undefined],
      ['/api/vehicles/2/rally', 'PUT', { points }],
      ['/api/vehicles/2/rally', 'GET', undefined],
    ])
  })

  it('reads the fence parameters and sets FENCE_ALT_MAX through a confirmed parameter write', async () => {
    const f = stub((url) => (url.endsWith('/confirm') ? envelope({ confirm_token: 'tok', expires_in: 30 }) : url.endsWith('/1/params') ? envelope([{ name: 'FENCE_ALT_MAX', requested: 150, actual: 150, verified: true }]) : envelope({ enabled: true, alt_max: 120, alt_max_on: true, zones_on: true })))
    expect(await readFenceParams(1)).toMatchObject({ alt_max: 120 })
    expect(await setFenceAltMax(1, 150)).toBe(true)
    const calls = f.mock.calls.map(([url, init]) => [String(url), init?.method ?? 'GET', typeof init?.body === 'string' ? JSON.parse(init.body) : undefined])
    expect(calls).toEqual([
      ['/api/vehicles/1/fence/params', 'GET', undefined],
      ['/api/vehicles/1/confirm', 'POST', { cmd: 'param_write' }],
      ['/api/vehicles/1/params', 'PUT', { changes: [{ name: 'FENCE_ALT_MAX', value: 150 }], confirm_token: 'tok' }],
    ])
  })

  it('export returns the raw text and import sends text/plain with the name header', async () => {
    const f = stub((url) => (url.includes('/export') ? new Response('QGC WPL 110\n', { status: 200, headers: { 'content-type': 'text/plain' } }) : envelope(mission)))
    expect(await exportWaypoints(5)).toBe('QGC WPL 110\n')
    expect(String(f.mock.calls[0]?.[0])).toBe('/api/missions/5/export?format=waypoints')
    await importWaypoints('QGC WPL 110\n0\t1…', 'from mp')
    const [url, init] = f.mock.calls[1] ?? []
    expect(String(url)).toBe('/api/missions/import')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('QGC WPL 110\n0\t1…')
    const headers = init?.headers as Record<string, string>
    expect(headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(headers['X-Mission-Name']).toBe('from mp')
    expect(headers['X-Requested-With']).toBe('rgcs')
  })

  it('export failures throw an ApiError with the envelope code', async () => {
    stub(() => new Response(JSON.stringify({ success: false, error: { code: 'not_found', message: 'x' } }), { status: 404 }))
    await expect(exportWaypoints(9)).rejects.toMatchObject({ code: 'not_found', status: 404 })
  })
})
