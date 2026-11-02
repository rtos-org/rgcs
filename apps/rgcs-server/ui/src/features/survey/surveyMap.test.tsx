import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Map as MlMap } from 'maplibre-gl'
import type { Draft } from '../mission/model'
import { generateSurvey } from './generate'
import { HOME, surveyDraft } from './surveyFixture'
import { handleAngle, handlePoint } from './surveyGeo'

type Handler = (e?: unknown) => void
const markers: FakeMarker[] = []

class FakeMarker {
  el: HTMLElement
  draggable: boolean
  lngLat: [number, number] = [0, 0]
  removed = false
  handlers = new Map<string, Handler[]>()
  constructor(o: { element: HTMLElement; draggable?: boolean }) {
    this.el = o.element
    this.draggable = o.draggable ?? false
    markers.push(this)
  }
  setLngLat(ll: [number, number]) {
    this.lngLat = ll
    return this
  }
  getLngLat() {
    return { lng: this.lngLat[0], lat: this.lngLat[1] }
  }
  addTo() {
    return this
  }
  remove() {
    this.removed = true
  }
  on(ev: string, cb: Handler) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), cb])
    return this
  }
  fire(ev: string) {
    this.handlers.get(ev)?.forEach((cb) => cb())
  }
}

vi.mock('maplibre-gl', () => ({ default: { Marker: FakeMarker } }))
const { useSurveyMap } = await import('./surveyMap')

interface Layer {
  id: string
  type: string
  minzoom?: number
  layout?: Record<string, unknown>
  paint?: Record<string, unknown>
}

function fakeMap() {
  const layers = new Map<string, Layer>()
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>()
  const visibility = new Map<string, string>()
  const before = new Map<string, string | undefined>()
  const m = {
    layers,
    sources,
    visibility,
    before,
    addSource: (id: string) => sources.set(id, { setData: vi.fn() }),
    getSource: (id: string) => sources.get(id),
    addLayer: (l: Layer, b?: string) => {
      layers.set(l.id, l)
      before.set(l.id, b)
    },
    getLayer: (id: string) => layers.get(id),
    setLayoutProperty: (id: string, _k: string, v: string) => visibility.set(id, v),
    once: (_ev: string, cb: Handler) => cb(),
  }
  return m
}

const live = () => markers.filter((m) => !m.removed)
const vertices = () => live().filter((m) => m.el.classList.contains('sv-vtx'))
const handle = () => live().find((m) => m.el.classList.contains('sv-rot'))

function setup(over: { draft?: Draft; editable?: boolean; is3d?: boolean; showFootprints?: boolean } = {}) {
  const { draft, id } = surveyDraft()
  const gen = generateSurvey(draft.surveys[0]!.spec, HOME)
  if ('error' in gen) throw new Error(gen.error)
  const fake = fakeMap()
  const onPolygon = vi.fn()
  const onAngle = vi.fn()
  const onCancel = vi.fn()
  const props = { draft: over.draft ?? draft, editable: over.editable ?? true, is3d: over.is3d ?? false, showFootprints: over.showFootprints ?? false }
  const hook = renderHook((p: typeof props) =>
    useSurveyMap({ map: { current: fake as unknown as MlMap }, loaded: { current: true }, metrics: (sid) => (sid === id ? gen : null), onPolygon, onAngle, onCancel, previewing: false, ...p }),
  { initialProps: props })
  return { fake, id, draft, onPolygon, onAngle, onCancel, hook, props }
}

describe('useSurveyMap', () => {
  beforeEach(() => {
    markers.length = 0
  })

  it('adds the survey- layers and sets every kind of feature', () => {
    const { fake } = setup()
    expect([...fake.layers.keys()].every((id) => id.startsWith('survey-'))).toBe(true)
    const kinds = new Set((fake.sources.get('survey')!.setData.mock.calls.at(-1)![0] as { features: { properties: { kind: string } }[] }).features.map((f) => f.properties.kind))
    expect([...kinds].sort()).toEqual(['area', 'foot', 'handle', 'link', 'photo', 'shoot'])
  })

  it('shoot at width 4, link at 1.5 dashed, photos only from zoom 16', () => {
    const { fake } = setup()
    const shoot = fake.layers.get('survey-shoot')!
    const link = fake.layers.get('survey-link')!
    expect(shoot.paint!['line-width']).toBe(4)
    expect(link.paint!['line-width']).toBe(1.5)
    expect(link.paint!['line-dasharray']).toBeDefined()
    expect(fake.layers.get('survey-photo')!.minzoom).toBe(16)
  })

  it('footprints follow the toggle', () => {
    const s = setup()
    expect(s.fake.visibility.get('survey-foot')).toBe('none')
    s.hook.rerender({ ...s.props, showFootprints: true })
    expect(s.fake.visibility.get('survey-foot')).toBe('visible')
  })

  it('adds nothing while the draft has no surveys', () => {
    const { draft } = surveyDraft()
    const { fake } = setup({ draft: { ...draft, surveys: [] } })
    expect(fake.layers.size).toBe(0)
    expect(live()).toHaveLength(0)
  })

  it('dragging a vertex previews the ring, and its release commits it', () => {
    const s = setup()
    const ring = s.draft.surveys[0]!.spec.polygon
    expect(vertices()).toHaveLength(ring.length)
    const v = vertices()[2]!
    act(() => {
      v.fire('dragstart')
      v.setLngLat([ring[2]!.lon + 0.001, ring[2]!.lat])
      v.fire('drag')
    })
    const moved = ring.map((p, i) => (i === 2 ? { lat: p.lat, lon: p.lon + 0.001 } : p))
    expect(s.onPolygon).toHaveBeenLastCalledWith(s.id, moved, false)
    act(() => v.fire('dragend'))
    expect(s.onPolygon).toHaveBeenLastCalledWith(s.id, moved, true)
    expect(s.onPolygon).toHaveBeenCalledTimes(2)
  })

  it('dragging the rotate handle sends the bearing from the centroid, rounded to 1°', () => {
    const s = setup()
    const ring = s.draft.surveys[0]!.spec.polygon
    const h = handle()!
    const target = handlePoint(ring, 47.6)!
    act(() => {
      h.fire('dragstart')
      h.setLngLat([target.lon, target.lat])
      h.fire('drag')
    })
    expect(handleAngle(ring, target)).toBe(48)
    expect(s.onAngle).toHaveBeenLastCalledWith(s.id, 48, false)
    act(() => h.fire('dragend'))
    expect(s.onAngle).toHaveBeenLastCalledWith(s.id, 48, true)
  })

  it('the handle sits at the handle point; markers follow a new draft and go when not editable', () => {
    const s = setup()
    const spec = s.draft.surveys[0]!.spec
    const p = handlePoint(spec.polygon, spec.angleDeg)!
    expect(handle()!.lngLat).toEqual([p.lon, p.lat])
    const rotated: Draft = { ...s.draft, surveys: [{ ...s.draft.surveys[0]!, spec: { ...spec, angleDeg: 0 } }] }
    s.hook.rerender({ ...s.props, draft: rotated })
    const q = handlePoint(spec.polygon, 0)!
    expect(handle()!.lngLat).toEqual([q.lon, q.lat])
    s.hook.rerender({ ...s.props, draft: rotated, editable: false })
    expect(live()).toHaveLength(0)
  })

  it('3D hides the flat flight lines (the 3D path shows them); the area stays draped', () => {
    const s = setup({ is3d: true })
    for (const id of ['survey-shoot', 'survey-link', 'survey-photo', 'survey-area-line']) expect(s.fake.visibility.get(id)).toBe('none')
    expect(s.fake.visibility.get('survey-area-fill')).not.toBe('none')
    s.hook.rerender({ ...s.props, is3d: false })
    expect(s.fake.visibility.get('survey-shoot')).toBe('visible')
  })

  it('a marker removed mid-drag ends the drag: the preview is dropped, and a later drag starts clean', () => {
    const s = setup()
    const v = vertices()[1]!
    act(() => {
      v.fire('dragstart')
      v.fire('drag')
    })
    s.hook.rerender({ ...s.props, editable: false })
    expect(v.removed).toBe(true)
    expect(s.onCancel).toHaveBeenCalledTimes(1)
    // a late dragend from the removed marker sends nothing
    act(() => v.fire('dragend'))
    expect(s.onPolygon).toHaveBeenCalledTimes(1)
    s.hook.rerender({ ...s.props, editable: true })
    const h = handle()!
    act(() => h.fire('dragstart'))
    s.hook.rerender({ ...s.props, draft: { ...s.draft, surveys: [] } })
    expect(s.onCancel).toHaveBeenCalledTimes(2)
  })

  it('removing markers that are not being dragged leaves any preview alone', () => {
    const s = setup()
    s.hook.rerender({ ...s.props, editable: false })
    expect(s.onCancel).not.toHaveBeenCalled()
  })
})
