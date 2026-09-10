/**
 * A RECORDING WebGL2 CONTEXT. Ticket `0055`, criteria 3 and 4.
 *
 * Criterion 4 asks for *"a test [that] asserts GL state (blend equation, blend func, bound FBO,
 * viewport) is restored so MapLibre's own drawing is unaffected"*. That is a question about the
 * SEQUENCE of calls the pass makes and the state it leaves behind — not about pixels — so it is
 * answered here, deterministically, in the normal `npm test` run rather than in a browser.
 *
 * THE OTHER HALF IS `tools/fog-harness`, and the split is deliberate. This fake cannot tell you
 * whether a driver honours `gl.MAX`, whether `a_fraction` actually dims a disc, or whether adjacent
 * discs merge — those are claims about rasterisation and only a real GPU can answer them. `0118`
 * established that division and the reason for it: a probe that can only report success is a
 * decoration. So the rule for anything added here is: if the assertion would still pass against a
 * driver that silently ignored the call, it belongs in the harness instead.
 *
 * Not a general WebGL emulator. It implements exactly what `mask.ts` calls, and anything else is a
 * missing method rather than a silent no-op — a fake that answers everything would let a typo in a
 * GL call name pass as a working test.
 */

/** The subset of WebGL2 enum values `mask.ts` uses, by their real numeric values. */
const ENUM = {
  VERTEX_SHADER: 0x8b31,
  FRAGMENT_SHADER: 0x8b30,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  ARRAY_BUFFER: 0x8892,
  STATIC_DRAW: 0x88e4,
  DYNAMIC_DRAW: 0x88e8,
  FLOAT: 0x1406,
  TEXTURE_2D: 0x0de1,
  R8: 0x8229,
  RED: 0x1903,
  RGBA: 0x1908,
  UNSIGNED_BYTE: 0x1401,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  LINEAR: 0x2601,
  CLAMP_TO_EDGE: 0x812f,
  FRAMEBUFFER: 0x8d40,
  COLOR_ATTACHMENT0: 0x8ce0,
  FRAMEBUFFER_BINDING: 0x8ca6,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  COLOR_BUFFER_BIT: 0x4000,
  DEPTH_TEST: 0x0b71,
  BLEND: 0x0be2,
  FUNC_ADD: 0x8006,
  MIN: 0x8007,
  MAX: 0x8008,
  ONE: 1,
  ZERO: 0,
  ONE_MINUS_SRC_ALPHA: 0x0303,
  BLEND_EQUATION_RGB: 0x8009,
  BLEND_EQUATION_ALPHA: 0x883d,
  BLEND_SRC_RGB: 0x80c9,
  BLEND_DST_RGB: 0x80c8,
  VIEWPORT: 0x0ba2,
  TRIANGLE_STRIP: 5,
  TRIANGLES: 4,
  TEXTURE0: 0x84c0,
  NO_ERROR: 0,
  MAX_TEXTURE_SIZE: 0x0d33,
} as const

/**
 * `0056`. The composite's uniforms all resolve; the mask's globe uniforms still do not.
 *
 * The asymmetry is the real compiler's, not a convenience: under mercator the globe uniforms are
 * unused and stripped, so their locations come back null and `setProjectionUniforms`'s guards are
 * load-bearing. Every uniform the composite declares is genuinely used by its shader, so a null
 * location there would mean a typo — which is what makes asserting the `uniform*` calls meaningful.
 */
const COMPOSITE_UNIFORMS = new Set([
  "u_mask",
  "u_noiseMatrix",
  "u_noiseOrigin",
  "u_time",
  "u_fogDeep",
  "u_fogEdge",
  "u_rimGlow",
  "u_maxOpacity",
  "u_noiseAmp",
  "u_rimAmt",
])

export interface GlCall {
  name: string
  args: readonly unknown[]
}

export interface FakeGl {
  gl: WebGL2RenderingContext
  /** Every call, in order. The sequence is what criterion 4's assertions are made of. */
  calls: GlCall[]
  /** Calls of one name, in order. */
  of(name: string): GlCall[]
  /** The last uploaded instance data, as `bufferData`/`bufferSubData` saw it. */
  uploads: Float32Array[]
  /** Shader sources, keyed by the shader type they were compiled as. */
  sources: { vertex: string[]; fragment: string[] }
  /** Fail the next `compileShader`, to exercise the layer's error path. */
  failCompile: boolean
}

/**
 * `drawingBufferWidth`/`Height` default to a 2:1 landscape so the half-res mask is 400x300 — big
 * enough that a wrong `Math.floor` shows up, and not square, so a transposed width/height would be
 * visible rather than accidentally correct.
 */
export function fakeGl(size: { width?: number; height?: number } = {}): FakeGl {
  const calls: GlCall[] = []
  const uploads: Float32Array[] = []
  const sources: { vertex: string[]; fragment: string[] } = { vertex: [], fragment: [] }
  const shaderTypes = new Map<object, number>()
  const state = {
    blendEquationRGB: ENUM.FUNC_ADD as number,
    blendEquationAlpha: ENUM.FUNC_ADD as number,
    blendSrcRGB: ENUM.ONE as number,
    blendDstRGB: ENUM.ZERO as number,
    framebuffer: null as object | null,
    viewport: new Int32Array([0, 0, size.width ?? 800, size.height ?? 600]),
  }

  const record = (name: string, ...args: unknown[]) => {
    calls.push({ name, args })
  }
  const handle = (tag: string) => ({ tag })

  const fake: FakeGl = {
    calls,
    uploads,
    sources,
    failCompile: false,
    of: (name) => calls.filter((c) => c.name === name),
    gl: null as unknown as WebGL2RenderingContext,
  }

  const gl = {
    ...ENUM,
    drawingBufferWidth: size.width ?? 800,
    drawingBufferHeight: size.height ?? 600,

    createShader(type: number) {
      const shader = handle("shader")
      shaderTypes.set(shader, type)
      record("createShader", type)
      return shader
    },
    shaderSource(shader: object, source: string) {
      const bucket = shaderTypes.get(shader) === ENUM.VERTEX_SHADER ? "vertex" : "fragment"
      sources[bucket].push(source)
      record("shaderSource", shader, source)
    },
    compileShader: (s: object) => record("compileShader", s),
    getShaderParameter: () => !fake.failCompile,
    getShaderInfoLog: () => "fake compile failure",
    deleteShader: (s: object) => record("deleteShader", s),

    createProgram: () => {
      record("createProgram")
      return handle("program")
    },
    attachShader: (p: object, s: object) => record("attachShader", p, s),
    linkProgram: (p: object) => record("linkProgram", p),
    getProgramParameter: () => true,
    getProgramInfoLog: () => "",
    deleteProgram: (p: object) => record("deleteProgram", p),
    useProgram: (p: object) => record("useProgram", p),

    createBuffer: () => {
      record("createBuffer")
      return handle("buffer")
    },
    bindBuffer: (target: number, b: object | null) => record("bindBuffer", target, b),
    bufferData(target: number, data: Float32Array | number, usage: number) {
      if (typeof data !== "number") uploads.push(new Float32Array(data))
      record("bufferData", target, data, usage)
    },
    bufferSubData(target: number, offset: number, data: Float32Array) {
      uploads.push(new Float32Array(data))
      record("bufferSubData", target, offset, data)
    },
    deleteBuffer: (b: object) => record("deleteBuffer", b),

    createVertexArray: () => {
      record("createVertexArray")
      return handle("vao")
    },
    bindVertexArray: (v: object | null) => record("bindVertexArray", v),
    deleteVertexArray: (v: object) => record("deleteVertexArray", v),
    // Distinct locations per name, so a VAO that pointed two attributes at the same slot would show
    // up in `vertexAttribPointer`'s recorded arguments rather than look identical.
    getAttribLocation: (_p: object, name: string) =>
      ["a_quad", "a_center", "a_radius", "a_fraction"].indexOf(name),
    enableVertexAttribArray: (loc: number) => record("enableVertexAttribArray", loc),
    vertexAttribPointer: (...args: unknown[]) => record("vertexAttribPointer", ...args),
    vertexAttribDivisor: (loc: number, divisor: number) =>
      record("vertexAttribDivisor", loc, divisor),

    createTexture: () => {
      record("createTexture")
      return handle("texture")
    },
    bindTexture: (target: number, t: object | null) => record("bindTexture", target, t),
    texImage2D: (...args: unknown[]) => record("texImage2D", ...args),
    texParameteri: (...args: unknown[]) => record("texParameteri", ...args),
    activeTexture: (unit: number) => record("activeTexture", unit),
    deleteTexture: (t: object) => record("deleteTexture", t),

    createFramebuffer: () => {
      record("createFramebuffer")
      return handle("fbo")
    },
    bindFramebuffer(target: number, f: object | null) {
      state.framebuffer = f
      record("bindFramebuffer", target, f)
    },
    framebufferTexture2D: (...args: unknown[]) => record("framebufferTexture2D", ...args),
    checkFramebufferStatus: () => ENUM.FRAMEBUFFER_COMPLETE,
    deleteFramebuffer: (f: object) => record("deleteFramebuffer", f),

    getUniformLocation: (_p: object, name: string) =>
      // Only the mercator uniforms resolve, exactly as a real compiler leaves them: under mercator
      // the globe uniforms are unused and stripped, so their locations come back null. That is what
      // makes the null-guards in `setProjectionUniforms` load-bearing rather than decorative.
      name === "u_projection_matrix" || COMPOSITE_UNIFORMS.has(name) ? handle(name) : null,
    uniformMatrix4fv: (...args: unknown[]) => record("uniformMatrix4fv", ...args),
    uniformMatrix3fv: (...args: unknown[]) => record("uniformMatrix3fv", ...args),
    uniform4fv: (...args: unknown[]) => record("uniform4fv", ...args),
    uniform3f: (...args: unknown[]) => record("uniform3f", ...args),
    uniform2f: (...args: unknown[]) => record("uniform2f", ...args),
    uniform1f: (...args: unknown[]) => record("uniform1f", ...args),
    uniform1i: (...args: unknown[]) => record("uniform1i", ...args),

    viewport(x: number, y: number, w: number, h: number) {
      state.viewport = new Int32Array([x, y, w, h])
      record("viewport", x, y, w, h)
    },
    clearColor: (...args: unknown[]) => record("clearColor", ...args),
    clear: (mask: number) => record("clear", mask),
    enable: (cap: number) => record("enable", cap),
    disable: (cap: number) => record("disable", cap),
    blendEquation(mode: number) {
      state.blendEquationRGB = mode
      state.blendEquationAlpha = mode
      record("blendEquation", mode)
    },
    blendFunc(src: number, dst: number) {
      state.blendSrcRGB = src
      state.blendDstRGB = dst
      record("blendFunc", src, dst)
    },
    drawArraysInstanced: (...args: unknown[]) => record("drawArraysInstanced", ...args),
    drawArrays: (...args: unknown[]) => record("drawArrays", ...args),
    readPixels: (...args: unknown[]) => record("readPixels", ...args),
    getError: () => ENUM.NO_ERROR,

    getParameter(name: number) {
      switch (name) {
        case ENUM.VIEWPORT:
          return state.viewport
        case ENUM.BLEND_EQUATION_RGB:
          return state.blendEquationRGB
        case ENUM.BLEND_EQUATION_ALPHA:
          return state.blendEquationAlpha
        case ENUM.BLEND_SRC_RGB:
          return state.blendSrcRGB
        case ENUM.BLEND_DST_RGB:
          return state.blendDstRGB
        case ENUM.FRAMEBUFFER_BINDING:
          return state.framebuffer
        case ENUM.MAX_TEXTURE_SIZE:
          return 8192
        default:
          throw new Error(`fake-gl: getParameter(0x${name.toString(16)}) is not implemented`)
      }
    },
  }

  fake.gl = gl as unknown as WebGL2RenderingContext
  return fake
}

export { ENUM as GL }
