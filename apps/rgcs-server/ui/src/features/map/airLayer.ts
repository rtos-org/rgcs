// True 3D polylines (prototype AirPathLayer): constant pixel width extruded in the vertex shader,
// feathered edges, a dark casing pass, and thin vertical posts. GL state is touched ONLY inside
// render() — MapLibre caches GL state and raster tiles go black otherwise — and buffers are
// uploaded there too (memory: RGCS mission UI conventions).
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl'
import type { AirVertex } from './air'

/** pos(3) prev(3) next(3) side(1) colour(3) */
export const FLOATS_PER_VERTEX = 13

export interface Strip {
  readonly data: Float32Array
  readonly pathCount: number
  readonly postCount: number
  readonly origin: readonly [number, number, number]
}

const EMPTY_STRIP: Strip = { data: new Float32Array(0), pathCount: 0, postCount: 0, origin: [0, 0, 0] }

/** One triangle strip for the path, then one for the posts; lines joined by degenerate vertices. */
export function buildStrip(lines: readonly (readonly AirVertex[])[], posts: readonly (readonly AirVertex[])[]): Strip {
  const path = lines.filter((l) => l.length > 1)
  const poles = posts.filter((l) => l.length > 1)
  const first = path[0]?.[0] ?? poles[0]?.[0]
  if (!first) return EMPTY_STRIP
  const o: [number, number, number] = [first.x, first.y, first.z]
  const out: number[] = []
  const push = (p: AirVertex, q: AirVertex, n: AirVertex, side: number) =>
    out.push(p.x - o[0], p.y - o[1], p.z - o[2], q.x - o[0], q.y - o[1], q.z - o[2], n.x - o[0], n.y - o[1], n.z - o[2], side, p.c[0], p.c[1], p.c[2])
  const strip = (ls: readonly (readonly AirVertex[])[]) =>
    ls.forEach((l, li) =>
      l.forEach((p, i) => {
        const q = l[i - 1] ?? p
        const n = l[i + 1] ?? p
        if (i === 0 && li > 0) push(p, q, n, -1)
        push(p, q, n, -1)
        push(p, q, n, 1)
        if (i === l.length - 1 && li < ls.length - 1) push(p, q, n, 1)
      }),
    )
  strip(path)
  const pathCount = out.length / FLOATS_PER_VERTEX
  strip(poles)
  return { data: new Float32Array(out), pathCount, postCount: out.length / FLOATS_PER_VERTEX - pathCount, origin: o }
}

const VS = `#version 300 es
in vec3 a_pos;in vec3 a_prev;in vec3 a_next;in float a_side;in vec3 a_color;
uniform mat4 u_matrix;uniform vec2 u_res;uniform float u_width;out float v_side;out vec3 v_color;
vec2 px(vec4 c){return c.xy/c.w*u_res*0.5;}
void main(){vec4 cp=u_matrix*vec4(a_pos,1.0);vec4 cq=u_matrix*vec4(a_prev,1.0);vec4 cn=u_matrix*vec4(a_next,1.0);
vec2 p=px(cp),q=px(cq),n=px(cn);vec2 d1=p-q,d2=n-p;
if(length(d1)<0.01)d1=d2;if(length(d2)<0.01)d2=d1;d1=length(d1)<0.01?vec2(1.0,0.0):normalize(d1);d2=length(d2)<0.01?d1:normalize(d2);
vec2 t=d1+d2;vec2 dir=length(t)<0.01?d1:normalize(t);vec2 nrm=vec2(-dir.y,dir.x);
float miter=min(1.0/max(0.4,dot(nrm,vec2(-d1.y,d1.x))),2.0);
vec2 off=nrm*a_side*u_width*0.5*miter;
gl_Position=vec4(cp.xy+off/(u_res*0.5)*cp.w,cp.z,cp.w);v_side=a_side;v_color=a_color;}`

const FS = `#version 300 es
precision mediump float;in float v_side;in vec3 v_color;uniform float u_opacity;uniform vec3 u_tint;uniform float u_tintMix;out vec4 o;
void main(){float a=(1.0-smoothstep(0.55,1.0,abs(v_side)))*u_opacity;vec3 c=mix(v_color,u_tint,u_tintMix);o=vec4(c*a,a);}`

const ATTRS = [
  ['a_pos', 3, 0],
  ['a_prev', 3, 12],
  ['a_next', 3, 24],
  ['a_side', 1, 36],
  ['a_color', 3, 40],
] as const

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

/** Column 3 += M · origin: vertices are stored relative to the strip origin (float precision). */
export function foldOrigin(matrix: ArrayLike<number>, o: readonly [number, number, number]): Float32Array {
  const m = Float64Array.from(matrix as ArrayLike<number>)
  for (let r = 0; r < 4; r++) m[12 + r] = m[12 + r]! + m[r]! * o[0] + m[4 + r]! * o[1] + m[8 + r]! * o[2]
  return new Float32Array(m)
}

function sameStrip(a: Strip, b: Strip): boolean {
  if (a.pathCount !== b.pathCount || a.postCount !== b.postCount || a.data.length !== b.data.length) return false
  if (a.origin.some((v, i) => v !== b.origin[i])) return false
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false
  return true
}

export class AirPathLayer implements CustomLayerInterface {
  readonly type = 'custom' as const
  readonly renderingMode = '3d' as const
  visible = false
  widthPx = 4
  postPx = 2
  /** Called with the frame's matrix after drawing (the marker floating uses the same one). */
  onFrame: ((matrix: ArrayLike<number>) => void) | null = null
  private gl: WebGL2RenderingContext | null = null
  private map: MlMap | null = null
  private prog: WebGLProgram | null = null
  private vao: WebGLVertexArrayObject | null = null
  private buf: WebGLBuffer | null = null
  private strip: Strip = EMPTY_STRIP
  private pending: Strip | null = null

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
    if (this.buf) gl.deleteBuffer(this.buf)
    if (this.vao) gl.deleteVertexArray(this.vao)
    if (this.prog) gl.deleteProgram(this.prog)
  }

  setLines(lines: readonly (readonly AirVertex[])[], posts: readonly (readonly AirVertex[])[]): void {
    const next = buildStrip(lines, posts)
    // telemetry re-sends the same picture many times a second; a repaint of the 3D terrain is costly
    if (sameStrip(next, this.pending ?? this.strip)) return
    this.pending = next
    this.map?.triggerRepaint()
  }

  private upload(gl: WebGL2RenderingContext, prog: WebGLProgram, s: Strip): void {
    this.vao ??= gl.createVertexArray()
    this.buf ??= gl.createBuffer()
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferData(gl.ARRAY_BUFFER, s.data, gl.STATIC_DRAW)
    for (const [name, n, off] of ATTRS) {
      const loc = gl.getAttribLocation(prog, name)
      if (loc < 0) continue
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, FLOATS_PER_VERTEX * 4, off)
    }
    gl.bindVertexArray(null)
    this.strip = s
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const gl = this.gl
    const prog = this.prog
    if (!gl || !prog) return
    if (this.pending) {
      this.upload(gl, prog, this.pending)
      this.pending = null
    }
    const matrix = args.defaultProjectionData.mainMatrix
    if (this.visible) this.onFrame?.(matrix)
    const s = this.strip
    if (!this.visible || s.pathCount + s.postCount === 0) return
    this.draw(gl, prog, foldOrigin(matrix, s.origin), s)
  }

  private draw(gl: WebGL2RenderingContext, prog: WebGLProgram, m: Float32Array, s: Strip): void {
    const u = (name: string) => gl.getUniformLocation(prog, name)
    gl.useProgram(prog)
    gl.uniformMatrix4fv(u('u_matrix'), false, m)
    gl.uniform2f(u('u_res'), gl.drawingBufferWidth, gl.drawingBufferHeight)
    gl.uniform3f(u('u_tint'), 0.02, 0.19, 0.23)
    gl.bindVertexArray(this.vao)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    const dpr = window.devicePixelRatio || 1
    const pass = (start: number, n: number, w: number, op: number, tint: boolean) => {
      if (!n) return
      gl.uniform1f(u('u_width'), w * dpr)
      gl.uniform1f(u('u_opacity'), op)
      gl.uniform1f(u('u_tintMix'), tint ? 1 : 0)
      gl.drawArrays(gl.TRIANGLE_STRIP, start, n)
    }
    // posts first (thin, translucent) so the path always reads on top of them
    gl.depthMask(false)
    pass(s.pathCount, s.postCount, this.postPx + 2, 0.35, true)
    pass(s.pathCount, s.postCount, this.postPx, 0.6, false)
    pass(0, s.pathCount, this.widthPx + 3, 0.75, true)
    gl.depthMask(true)
    pass(0, s.pathCount, this.widthPx, 0.95, false)
    gl.bindVertexArray(null)
  }
}
