// 3D vehicle models (low-poly, meshes.ts) as a MapLibre custom layer. Like AirPathLayer, GL state
// is touched only inside render() and buffers are uploaded there (MapLibre caches GL state).
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl'
import type { Rgb } from '../air'
import { FLOATS, meshFor, type ModelKey } from './meshes'
import { bodyBasis, modelMatrix, mul4, screenSizeMerc, type ModelAt } from './placement'

export interface VehicleModel {
  readonly sysid: number
  readonly model: ModelKey
  readonly at: ModelAt
  /** Degrees clockwise from north. */
  readonly hdg: number
  /** Wing / rotor / top colour (selection amber, else the accent). */
  readonly accent: Rgb
  /** ATTITUDE roll / pitch (degrees); null flies level. */
  readonly attitude: { readonly roll: number; readonly pitch: number } | null
}

/** On-screen length (px) at the model's own depth; real airframes are far smaller. */
const MODEL_PX = 46
/** Real length (m) never drawn smaller than this, for close-up views. */
const REAL_M = 2
const EARTH_CIRCUMFERENCE = 40075016.686
/** Light from the south-west, above, in (east, north, up). */
const LIGHT: readonly [number, number, number] = [-0.45, -0.55, 0.7]

const VS = `#version 300 es
in vec3 a_pos;in vec3 a_nrm;in vec3 a_col;
uniform mat4 u_matrix;uniform mat3 u_basis;uniform vec3 u_light;uniform vec3 u_accent;out vec3 v_col;
void main(){gl_Position=u_matrix*vec4(a_pos,1.0);
vec3 c=a_col.r<0.0?u_accent:a_col;float d=abs(dot(normalize(u_basis*a_nrm),normalize(u_light)));
v_col=c*(0.42+0.58*d);}`
const FS = `#version 300 es
precision mediump float;in vec3 v_col;out vec4 o;void main(){o=vec4(v_col,1.0);}`

function compile(gl: WebGL2RenderingContext): WebGLProgram | null {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    return s
  }
  const prog = gl.createProgram()
  if (!prog) return null
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS))
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS))
  gl.linkProgram(prog)
  return gl.getProgramParameter(prog, gl.LINK_STATUS) ? prog : null
}

export class VehicleModelLayer implements CustomLayerInterface {
  readonly type = 'custom' as const
  readonly renderingMode = '3d' as const
  visible = false
  private gl: WebGL2RenderingContext | null = null
  private map: MlMap | null = null
  private prog: WebGLProgram | null = null
  private readonly meshes = new Map<ModelKey, { vao: WebGLVertexArrayObject; count: number }>()
  private models: readonly VehicleModel[] = []

  readonly id: string
  constructor(id: string) {
    this.id = id
  }

  onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    if (!('createVertexArray' in gl)) return
    this.map = map
    this.gl = gl
    this.prog = compile(gl)
  }

  onRemove(): void {
    const gl = this.gl
    if (!gl) return
    this.meshes.forEach((m) => gl.deleteVertexArray(m.vao))
    if (this.prog) gl.deleteProgram(this.prog)
  }

  setModels(models: readonly VehicleModel[]): void {
    this.models = models
    if (this.visible) this.map?.triggerRepaint()
  }

  private mesh(gl: WebGL2RenderingContext, prog: WebGLProgram, key: ModelKey) {
    const hit = this.meshes.get(key)
    if (hit) return hit
    const data = meshFor(key)
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    ;(['a_pos', 'a_nrm', 'a_col'] as const).forEach((name, i) => {
      const loc = gl.getAttribLocation(prog, name)
      if (loc < 0) return
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, FLOATS * 4, i * 12)
    })
    gl.bindVertexArray(null)
    const made = { vao, count: data.length / FLOATS }
    this.meshes.set(key, made)
    return made
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const gl = this.gl
    const prog = this.prog
    if (!gl || !prog || !this.visible || this.models.length === 0) return
    const frame = args.defaultProjectionData.mainMatrix
    const zoom = this.map?.getZoom() ?? 16
    const u = (name: string) => gl.getUniformLocation(prog, name)
    gl.useProgram(prog)
    gl.disable(gl.BLEND)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)
    for (const v of this.models) {
      const real = (REAL_M / (EARTH_CIRCUMFERENCE * Math.cos((v.at.lat * Math.PI) / 180)))
      const size = screenSizeMerc(MODEL_PX, zoom, real)
      gl.uniformMatrix4fv(u('u_matrix'), false, new Float32Array(mul4(frame, modelMatrix(v.at, v.hdg, size, v.attitude))))
      const b = bodyBasis(v.hdg, v.attitude?.roll ?? 0, v.attitude?.pitch ?? 0)
      gl.uniformMatrix3fv(u('u_basis'), false, new Float32Array([...b.right, ...b.nose, ...b.up]))
      gl.uniform3f(u('u_light'), LIGHT[0], LIGHT[1], LIGHT[2])
      gl.uniform3f(u('u_accent'), v.accent[0], v.accent[1], v.accent[2])
      const m = this.mesh(gl, prog, v.model)
      gl.bindVertexArray(m.vao)
      gl.drawArrays(gl.TRIANGLES, 0, m.count)
    }
    gl.bindVertexArray(null)
  }
}
