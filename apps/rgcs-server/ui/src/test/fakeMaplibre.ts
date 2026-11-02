// MapLibre stand-ins for map tests: maps and markers record what the code under test does with them.
import { vi } from 'vitest'

type Handler = (e?: unknown) => void
export const created = { maps: [] as FakeMap[], markers: [] as FakeMarker[], deferLoad: false }

export class FakeMarker {
  el: HTMLElement
  lngLat: [number, number] = [0, 0]
  draggable: boolean
  removed = false
  handlers = new Map<string, Handler[]>()
  constructor(opts: { element: HTMLElement; draggable?: boolean }) {
    this.el = opts.element
    this.draggable = opts.draggable ?? false
    created.markers.push(this)
  }
  getElement() {
    return this.el
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
  offset: [number, number] | null = null
  setDraggable(d: boolean) {
    this.draggable = d
    return this
  }
  setOffset(o: [number, number]) {
    this.offset = o
    return this
  }
  on(ev: string, cb: Handler) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), cb])
    return this
  }
  fire(ev: string, e?: unknown) {
    this.handlers.get(ev)?.forEach((cb) => cb(e))
  }
}

export class FakeMap {
  handlers = new Map<string, Handler[]>()
  sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>()
  options: unknown
  fitted: unknown[] = []
  constructor(options: unknown) {
    this.options = options
    created.maps.push(this)
  }
  on(ev: string, cb: Handler) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), cb])
    if (ev === 'load' && !created.deferLoad) cb()
  }
  fire(ev: string, e?: unknown) {
    this.handlers.get(ev)?.forEach((cb) => cb(e))
  }
  addControl() {}
  addSource(id: string) {
    this.sources.set(id, { setData: vi.fn() })
  }
  layers: string[] = []
  terrain: unknown = 'unset'
  visibility = new Map<string, string>()
  layerObjs = new Map<string, unknown>()
  before = new Map<string, string | undefined>()
  addLayer(l: { id: string }, before?: string) {
    this.layers.push(l.id)
    this.layerObjs.set(l.id, l)
    this.before.set(l.id, before)
  }
  once(ev: string, cb: Handler) {
    this.on(ev, cb)
  }
  getLayer(id: string) {
    return this.layers.includes(id) ? { id } : undefined
  }
  getStyle() {
    return { layers: this.layers.map((id) => ({ id })) }
  }
  removeLayer(id: string) {
    this.layers = this.layers.filter((x) => x !== id)
  }
  removeSource(id: string) {
    this.sources.delete(id)
  }
  moveLayer() {}
  stop() {}
  easeTo() {}
  jumps: unknown[] = []
  jumpTo(o: unknown) {
    this.jumps.push(o)
  }
  setTerrain(t: unknown) {
    this.terrain = t
  }
  sky: unknown = undefined
  setSky(s: unknown) {
    this.sky = s
  }
  paint = new Map<string, unknown>()
  setPaintProperty(id: string, k: string, v: unknown) {
    this.paint.set(`${id}.${k}`, v)
  }
  setLayoutProperty(id: string, _k: string, v: string) {
    this.visibility.set(id, v)
  }
  triggerRepaint() {}
  /** 1e-4° per px from (139, 36): enough to aim the arc gesture. */
  unproject(p: [number, number]) {
    return { lng: 139 + p[0] * 1e-4, lat: 36 - p[1] * 1e-4 }
  }
  getContainer() {
    return { clientWidth: 800, clientHeight: 600 }
  }
  project() {
    return { x: 0, y: 0 }
  }
  getSource(id: string) {
    return this.sources.get(id)
  }
  fitOptions: unknown[] = []
  fitBounds(b: unknown, o?: unknown) {
    this.fitted.push(b)
    this.fitOptions.push(o)
  }
  getCanvas() {
    return document.createElement('canvas')
  }
  remove() {}
}

/** The `maplibre-gl` module: `vi.mock('maplibre-gl', async () => (await import('…/fakeMaplibre')).maplibreModule)`. */
export const maplibreModule = {
  default: { Map: FakeMap, Marker: FakeMarker, NavigationControl: class {}, ScaleControl: class {}, LngLatBounds: class { extend() { return this } } },
}
