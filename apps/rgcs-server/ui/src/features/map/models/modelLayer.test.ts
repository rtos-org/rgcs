import { describe, expect, it } from 'vitest'
import { FLOATS, meshFor } from './meshes'
import { VehicleModelLayer } from './modelLayer'

/** A WebGL2 stand-in: every call is a no-op that returns a truthy handle; draws are recorded. */
function fakeGl() {
  const draws: number[] = []
  const gl = new Proxy({ drawingBufferWidth: 800, drawingBufferHeight: 600, createVertexArray: () => ({}) } as Record<string, unknown>, {
    get(t, k: string) {
      if (k in t) return t[k]
      if (k === 'drawArrays') return (_m: number, _f: number, n: number) => draws.push(n)
      if (k === 'getProgramParameter' || k === 'getShaderParameter') return () => true
      if (k === 'getAttribLocation') return () => 0
      if (/^[A-Z_0-9]+$/.test(k)) return 1
      return () => ({})
    },
  })
  return { gl: gl as unknown as WebGL2RenderingContext, draws }
}
const fakeMap = (zoom: number) => ({ getZoom: () => zoom, triggerRepaint: () => {} })
const frame = { defaultProjectionData: { mainMatrix: Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)) } } as never

describe('VehicleModelLayer', () => {
  it('draws one mesh per vehicle while visible, nothing in 2D', () => {
    const { gl, draws } = fakeGl()
    const layer = new VehicleModelLayer('veh-models')
    layer.onAdd(fakeMap(16) as never, gl)
    layer.setModels([
      { sysid: 1, model: 'plane', at: { lon: 137.6, lat: 36.2, amsl: 1600 }, hdg: 90, accent: [1, 0.7, 0.3], attitude: { roll: 30, pitch: 5 } },
      { sysid: 2, model: 'copter', at: { lon: 137.61, lat: 36.2, amsl: 1550 }, hdg: 0, accent: [0.6, 0.8, 1], attitude: null },
    ])
    layer.render(gl, frame)
    expect(draws).toEqual([])
    layer.visible = true
    layer.render(gl, frame)
    expect(draws).toEqual([meshFor('plane').length / FLOATS, meshFor('copter').length / FLOATS])
  })
})
