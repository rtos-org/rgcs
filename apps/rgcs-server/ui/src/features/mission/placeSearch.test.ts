import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseLatLon, searchPlaces } from './placeSearch'

describe('place search', () => {
  it('reads "lat, lon" in decimal degrees, comma or space separated', () => {
    expect(parseLatLon('35.0145, 138.5302')).toEqual({ lat: 35.0145, lon: 138.5302 })
    expect(parseLatLon(' 36.2509 137.6385 ')).toEqual({ lat: 36.2509, lon: 137.6385 })
    expect(parseLatLon('-33.86,151.21')).toEqual({ lat: -33.86, lon: 151.21 })
    expect(parseLatLon('35.0145，138.5302')).toEqual({ lat: 35.0145, lon: 138.5302 })
  })

  it('anything else is a place name', () => {
    expect(parseLatLon('三保飛行場')).toBeNull()
    expect(parseLatLon('95, 10')).toBeNull()
    expect(parseLatLon('35, 200')).toBeNull()
    expect(parseLatLon('35')).toBeNull()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('asks OpenStreetMap Nominatim in Japanese and returns up to five named hits', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify([{ lat: '35.0145295', lon: '138.5301943', name: '三保飛行場', display_name: '三保飛行場, 三保, 清水区, 静岡市' }]), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const hits = await searchPlaces('三保飛行場')
    expect(hits).toEqual([{ name: '三保飛行場', detail: '三保飛行場, 三保, 清水区, 静岡市', lat: 35.0145295, lon: 138.5301943 }])
    const url = new URL(String(fetchMock.mock.calls[0]![0]))
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search')
    expect(url.searchParams.get('q')).toBe('三保飛行場')
    expect(url.searchParams.get('accept-language')).toBe('ja')
    expect(url.searchParams.get('limit')).toBe('5')
  })

  it('a failed request throws', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('x', { status: 503 })))
    await expect(searchPlaces('東京駅')).rejects.toThrow()
  })
})
