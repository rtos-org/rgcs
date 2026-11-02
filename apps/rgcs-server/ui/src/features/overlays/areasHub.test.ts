import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OverlayRef } from './api'
import { AreasHub, areasOf } from './areasHub'
import { area } from './testData'

const LTE: OverlayRef = { plugin: 'carrier', overlay: 'lte' }
const PNG: OverlayRef = { plugin: 'carrier', overlay: 'png' }

describe('areas hub', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('loads_each_overlay_once_on_demand', async () => {
    const load = vi.fn(async (r: OverlayRef) => [area({ overlay_id: r.overlay })])
    const s = new AreasHub(load)
    s.subscribe(() => {})
    s.ensureLoaded(LTE)
    s.ensureLoaded(LTE)
    s.ensureLoaded(PNG)
    await vi.waitFor(() => expect(areasOf(s.getState(), 'carrier/png').loaded).toBe(true))
    expect(load).toHaveBeenCalledTimes(2)
    expect(areasOf(s.getState(), 'carrier/lte').areas).toEqual([area()])
    expect(areasOf(s.getState(), 'nobody/x')).toEqual({ areas: [], loaded: false, error: false })
  })

  it('polls_an_overlay_every_second_while_one_of_its_areas_is_fetching', async () => {
    const replies = [[area({ status: 'fetching' })], [area({ status: 'fetching' })], [area()]]
    const load = vi.fn(async () => replies.shift() ?? [area()])
    const s = new AreasHub(load)
    s.subscribe(() => {})
    await s.reload(LTE)
    await vi.advanceTimersByTimeAsync(1000)
    expect(load).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(load).toHaveBeenCalledTimes(3)
    expect(areasOf(s.getState(), 'carrier/lte').areas[0]!.status).toBe('ready')
    await vi.advanceTimersByTimeAsync(5000)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('stops_polling_when_nobody_listens', async () => {
    const load = vi.fn(async () => [area({ status: 'fetching' })])
    const s = new AreasHub(load)
    const off = s.subscribe(() => {})
    await s.reload(LTE)
    off()
    await vi.advanceTimersByTimeAsync(3000)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('a_failed_load_keeps_the_last_list_and_flags_the_error', async () => {
    const load = vi.fn().mockResolvedValueOnce([area()]).mockRejectedValueOnce(new Error('down'))
    const s = new AreasHub(load)
    await s.reload(LTE)
    await s.reload(LTE)
    expect(areasOf(s.getState(), 'carrier/lte')).toMatchObject({ areas: [area()], error: true, loaded: true })
  })
})
