/**
 * THROWAWAY. Ticket `0118` — the go/no-go spike for `05-fog-of-war.md` §4.
 *
 * `09-roadmap.md` §8.2 names this the mitigation for the project's largest technical
 * risk and `05` §9.6 states the unvalidated assumption precisely: **`MAX` blending
 * against `R8` on older Android GPUs via ANGLE**. Everything in this file exists to
 * answer that one question and is deleted when it has been answered. `0055` rebuilds
 * the mask pass properly, with the soft falloff, the real decoder and zoom bucketing.
 *
 * ─── ZERO IMPORTS, ON PURPOSE ───────────────────────────────────────────────
 *
 * Not a style preference — it is what makes this module runnable outside Next, outside
 * React and outside MapLibre. `tools/spike-harness` compiles this file alone with `tsc`
 * and drives it against a bare canvas in headless Chromium, which is how the numeric
 * half of the verdict is proved without asking anyone to open a browser. The instance
 * data arrives as a `Float32Array` argument for the same reason: `h3-js` lives in
 * `spike-cells.ts`, one import away from here and deliberately not in it.
 */

/* ─── Geometry constants (§4.1) ─────────────────────────────────────────────── */

/**
 * `revealScale`. §4.1: 1.35 × the res-10 circumradius, so a neighbour's disc overlaps
 * yours well past its half-power point and a contiguous run of cells becomes one
 * region with no scalloping.
 *
 * IT LIVES HERE AND NOT UNDER `src/`, and `scripts/check-fog-render-boundary.mjs`
 * enforces that. `REVEAL_R_M = 65` in `src/domain/fog.ts` decides what is explored,
 * permanently, under D-020. This number is a look. They must never meet.
 */
export const REVEAL_SCALE = 1.35

/** Mean circumradius of an H3 res-10 cell, metres (§2.1). */
export const CELL_CIRCUMRADIUS_M = 75.9

/** Earth's circumference at the equator, metres — WGS84 mean radius 6371008.8 m. */
export const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6371008.8

/** §4.2 — the mask is allocated at half the drawing buffer, and that is both cheaper and better. */
export const MASK_SCALE = 0.5

/* ─── Coverage values, and why they are not 1.0 ─────────────────────────────── */

/**
 * THE DISCS ARE MID-GREY, NOT WHITE, AND THE WHOLE SPIKE TURNS ON IT.
 *
 * The ticket says "flat white discs". Taken literally that makes the spike unable to
 * fail: `R8` is a normalised unsigned format, so under an ADDITIVE blend `1.0 + 1.0`
 * clamps to `1.0` — byte-identical to `max(1.0, 1.0)`. Two overlapping white discs
 * look exactly the same whether `MAX` is honoured or silently ignored, and both the
 * readback and the operator's eye would report a pass against a broken driver.
 *
 * At 0.45 the two outcomes are unmistakable: `max` stays 0.45 (115), a sum reaches
 * 0.90 (229). That is the difference the eye sees as "a brighter lens at the overlap"
 * and the difference `runMaxProbe` measures.
 */
export const DISC_COVERAGE = 0.45

/**
 * The probe pair. Deliberately unequal, so the readback distinguishes `max` (0.55)
 * from a sum (0.90) AND from "the second draw simply overwrote the first" (also 0.55
 * — which is why `PROBE_HIGH` is drawn FIRST and `PROBE_LOW` second; see `runMaxProbe`).
 */
export const PROBE_LOW = 0.35
export const PROBE_HIGH = 0.55

/** Float coverage as the `R8` byte it must land on. GL rounds to nearest. */
export function quantise(coverage: number): number {
  return Math.round(coverage * 255)
}

/* ─── Shaders ───────────────────────────────────────────────────────────────── */

/**
 * §4.2's vertex shader, with the prelude injected rather than hard-coded.
 *
 * MapLibre passes `shaderData.vertexShaderPrelude`, which declares the projection
 * uniform block and defines `vec4 projectTile(vec2)` — for mercator that is
 * `u_projection_matrix * vec4(p, 0, 1)`, for globe it is the sphere. Using it is what
 * gives the layer globe and terrain support for free, and it is why this shader must
 * NOT declare `u_projection_matrix` itself.
 *
 * The headless harness passes `STUB_PRELUDE` instead, which declares the same uniform
 * and defines the same function the same way. Same attribute layout, same uniform
 * name, same blend state, same FBO — so what the harness proves about `MAX` into `R8`
 * transfers, and what it cannot prove is only the prelude's own compilation.
 */
export function maskVertexSource(prelude: string, define: string): string {
  return `#version 300 es
${prelude}
${define}

in vec2  a_quad;     // unit quad corner, -1..1          (per-vertex, 4 verts)
in vec2  a_center;   // cell centre, web-mercator 0..1    (per-instance)
in float a_radius;   // disc radius, mercator units       (per-instance)
in float a_value;    // coverage this disc writes, 0..1    (per-instance)

out vec2  v_uv;
out float v_value;

void main() {
    v_uv = a_quad;
    v_value = a_value;
    // Offset in mercator space, then let MapLibre project. A mercator-space disc is
    // still a disc on screen, so no latitude correction is needed for the SHAPE;
    // a_radius carries the ground-size variation.
    gl_Position = projectTile(a_center + a_quad * a_radius);
}`
}

/**
 * FLAT discs, not §4.2's `1.0 - smoothstep(0.45, 1.0, d)` falloff. Deliberate, and
 * recorded so nobody reads it as an omission: a flat disc writes one exact byte, so
 * the readback in `runMaxProbe` compares integers rather than arguing about where a
 * gradient crosses a threshold. The soft edge is the look and it belongs to `0055`.
 */
export const MASK_FRAGMENT_SOURCE = `#version 300 es
precision mediump float;

in  vec2  v_uv;
in  float v_value;
out vec4  fragColor;

void main() {
    if (length(v_uv) > 1.0) discard;   // square quad, round disc
    fragColor = vec4(v_value, 0.0, 0.0, 1.0);
}`

/**
 * The prelude the harness substitutes for MapLibre's. Behaviourally identical to
 * MapLibre 6.6.0's mercator prelude (`shaders.projectionMercator`), which is
 * `vec4 projectTile(vec2 p) { return u_projection_matrix * vec4(p, 0.0, 1.0); }`.
 */
export const STUB_PRELUDE = `uniform mat4 u_projection_matrix;
vec4 projectTile(vec2 p) { return u_projection_matrix * vec4(p, 0.0, 1.0); }`

/** A full-screen triangle from `gl_VertexID` alone — no buffer, no attributes. */
export const BLIT_VERTEX_SOURCE = `#version 300 es
out vec2 v_uv;
void main() {
    vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
    v_uv = (p + 1.0) * 0.5;
    gl_Position = vec4(p, 0.0, 1.0);
}`

/**
 * Criterion 3's greyscale blit, and criterion 4's "basemap renders unchanged", which
 * only hold together if the veil is TRANSPARENT where the mask is zero.
 *
 * MapLibre's `render` pass sets `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)` and therefore
 * expects PREMULTIPLIED alpha, so the output is `vec4(rgb * a, a)`. Alpha carries the
 * mask value: unrevealed ground is untouched basemap, 0.45 coverage is a 45% haze, and
 * a summed 0.90 overlap is a near-black blot nobody could mistake for uniform.
 *
 * Near-black rather than white because the stock Protomaps `light` flavour is pale
 * (`0052` ships it unmodified; the parchment fork is capability 15) and a white veil on
 * a white basemap is exactly the ambiguity this spike must not produce.
 */
export const BLIT_FRAGMENT_SOURCE = `#version 300 es
precision mediump float;

uniform sampler2D u_mask;

in  vec2 v_uv;
out vec4 fragColor;

void main() {
    float m = texture(u_mask, v_uv).r;
    vec3 veil = vec3(0.06);
    fragColor = vec4(veil * m, m);   // premultiplied
}`

/* ─── Projection uniforms ───────────────────────────────────────────────────── */

/**
 * `CustomRenderMethodInput.defaultProjectionData`, structurally. Typed locally rather
 * than imported from `maplibre-gl` — see the header: this module stays import-free so
 * it can run without MapLibre at all.
 */
export type ProjectionLike = {
  mainMatrix: ArrayLike<number>
  tileMercatorCoords: readonly [number, number, number, number]
  clippingPlane: readonly [number, number, number, number]
  projectionTransition: number
  fallbackMatrix: ArrayLike<number>
  clipAntimeridian: boolean
}

/**
 * The six uniforms MapLibre's prelude declares, by the names its own documentation
 * gives them. EVERY `getUniformLocation` IS NULL-GUARDED: the harness's stub prelude
 * declares only `u_projection_matrix`, and under mercator MapLibre's own prelude
 * leaves the globe uniforms unused, so the GLSL compiler strips them. Setting a null
 * location is a silent no-op in WebGL, but reading one is not worth asserting on.
 */
export function setProjectionUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  p: ProjectionLike,
): void {
  const at = (name: string) => gl.getUniformLocation(program, name)
  const matrix = at("u_projection_matrix")
  if (matrix) gl.uniformMatrix4fv(matrix, false, new Float32Array(Array.from(p.mainMatrix)))
  const fallback = at("u_projection_fallback_matrix")
  if (fallback) gl.uniformMatrix4fv(fallback, false, new Float32Array(Array.from(p.fallbackMatrix)))
  const tile = at("u_projection_tile_mercator_coords")
  if (tile) gl.uniform4fv(tile, p.tileMercatorCoords as unknown as number[])
  const plane = at("u_projection_clipping_plane")
  if (plane) gl.uniform4fv(plane, p.clippingPlane as unknown as number[])
  const transition = at("u_projection_transition")
  if (transition) gl.uniform1f(transition, p.projectionTransition)
  const antimeridian = at("u_projection_clip_antimeridian")
  if (antimeridian) gl.uniform1f(antimeridian, p.clipAntimeridian ? 1 : 0)
}

/* ─── GL resources ──────────────────────────────────────────────────────────── */

/** Floats per instance: `a_center.xy`, `a_radius`, `a_value`. */
export const INSTANCE_FLOATS = 4

export type MaskResources = {
  maskProgram: WebGLProgram
  blitProgram: WebGLProgram
  quadBuffer: WebGLBuffer
  fieldBuffer: WebGLBuffer
  probeBuffer: WebGLBuffer
  fieldVAO: WebGLVertexArrayObject
  probeVAO: WebGLVertexArrayObject
  blitVAO: WebGLVertexArrayObject
  fbo: WebGLFramebuffer
  texture: WebGLTexture
  maskW: number
  maskH: number
  fieldCount: number
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error("createShader returned null")
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "(no log)"
    gl.deleteShader(shader)
    // The log, verbatim and unabridged. A driver-specific compile failure IS the
    // finding this spike exists to surface, so it must reach the verdict panel intact
    // rather than as "shader failed".
    throw new Error(`${type === gl.VERTEX_SHADER ? "vertex" : "fragment"} shader: ${log}`)
  }
  return shader
}

function link(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error("createProgram returned null")
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource)
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource)
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "(no log)"
    gl.deleteProgram(program)
    throw new Error(`link: ${log}`)
  }
  return program
}

/** The unit quad, as a 4-vertex `TRIANGLE_STRIP`. Shared by both instanced draws. */
const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])

function instancedVAO(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  quadBuffer: WebGLBuffer,
  instanceBuffer: WebGLBuffer,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()
  if (!vao) throw new Error("createVertexArray returned null")
  gl.bindVertexArray(vao)

  const quad = gl.getAttribLocation(program, "a_quad")
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
  gl.enableVertexAttribArray(quad)
  gl.vertexAttribPointer(quad, 2, gl.FLOAT, false, 0, 0)
  gl.vertexAttribDivisor(quad, 0)

  const stride = INSTANCE_FLOATS * 4
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer)
  for (const [name, size, offset] of [
    ["a_center", 2, 0],
    ["a_radius", 1, 8],
    ["a_value", 1, 12],
  ] as const) {
    const loc = gl.getAttribLocation(program, name)
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset)
    gl.vertexAttribDivisor(loc, 1)
  }

  gl.bindVertexArray(null)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
  return vao
}

/**
 * Allocate the half-resolution `R8` mask (§4.2): `LINEAR`, `CLAMP_TO_EDGE`.
 *
 * `LINEAR` matters even though nothing in this spike reads the mask at a different
 * scale than it was written: §4.2's reason is that the bilinear upsample in the
 * composite pass contributes a free extra feather, and allocating it any other way
 * here would mean `0055` inherits a texture whose filtering was never exercised.
 */
function allocateMask(
  gl: WebGL2RenderingContext,
  existing: { fbo: WebGLFramebuffer; texture: WebGLTexture } | null,
  width: number,
  height: number,
): { fbo: WebGLFramebuffer; texture: WebGLTexture } {
  const texture = existing?.texture ?? gl.createTexture()
  const fbo = existing?.fbo ?? gl.createFramebuffer()
  if (!texture || !fbo) throw new Error("createTexture/createFramebuffer returned null")

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.bindTexture(gl.TEXTURE_2D, null)
  return { fbo, texture }
}

export function createResources(
  gl: WebGL2RenderingContext,
  options: {
    prelude: string
    define: string
    /** `INSTANCE_FLOATS` per cell: centre x, centre y, radius, coverage. */
    field: Float32Array
    /** The probe pair, `PROBE_HIGH` first. See `runMaxProbe`. */
    probe: Float32Array
    width: number
    height: number
  },
): MaskResources {
  const maskProgram = link(gl, maskVertexSource(options.prelude, options.define), MASK_FRAGMENT_SOURCE)
  const blitProgram = link(gl, BLIT_VERTEX_SOURCE, BLIT_FRAGMENT_SOURCE)

  const quadBuffer = gl.createBuffer()
  const fieldBuffer = gl.createBuffer()
  const probeBuffer = gl.createBuffer()
  if (!quadBuffer || !fieldBuffer || !probeBuffer) throw new Error("createBuffer returned null")

  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW)
  gl.bindBuffer(gl.ARRAY_BUFFER, fieldBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, options.field, gl.STATIC_DRAW)
  gl.bindBuffer(gl.ARRAY_BUFFER, probeBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, options.probe, gl.STATIC_DRAW)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)

  /**
   * TWO VAOs RATHER THAN ONE WITH AN OFFSET. WebGL2 has no `baseInstance`, so drawing
   * "instances 2..N" of a single buffer means re-pointing the attributes between the
   * probe and the field every frame. Two VAOs is the same GPU cost and cannot get the
   * offset arithmetic wrong.
   */
  const fieldVAO = instancedVAO(gl, maskProgram, quadBuffer, fieldBuffer)
  const probeVAO = instancedVAO(gl, maskProgram, quadBuffer, probeBuffer)

  const blitVAO = gl.createVertexArray()
  if (!blitVAO) throw new Error("createVertexArray returned null")

  const maskW = Math.max(1, Math.floor(options.width * MASK_SCALE))
  const maskH = Math.max(1, Math.floor(options.height * MASK_SCALE))
  const { fbo, texture } = allocateMask(gl, null, maskW, maskH)

  return {
    maskProgram,
    blitProgram,
    quadBuffer,
    fieldBuffer,
    probeBuffer,
    fieldVAO,
    probeVAO,
    blitVAO,
    fbo,
    texture,
    maskW,
    maskH,
    fieldCount: options.field.length / INSTANCE_FLOATS,
  }
}

/** Reallocate the mask after a resize. Returns whether anything changed. */
export function resizeMask(gl: WebGL2RenderingContext, res: MaskResources, width: number, height: number): boolean {
  const maskW = Math.max(1, Math.floor(width * MASK_SCALE))
  const maskH = Math.max(1, Math.floor(height * MASK_SCALE))
  if (maskW === res.maskW && maskH === res.maskH) return false
  allocateMask(gl, { fbo: res.fbo, texture: res.texture }, maskW, maskH)
  res.maskW = maskW
  res.maskH = maskH
  return true
}

export function disposeResources(gl: WebGL2RenderingContext, res: MaskResources): void {
  gl.deleteProgram(res.maskProgram)
  gl.deleteProgram(res.blitProgram)
  gl.deleteBuffer(res.quadBuffer)
  gl.deleteBuffer(res.fieldBuffer)
  gl.deleteBuffer(res.probeBuffer)
  gl.deleteVertexArray(res.fieldVAO)
  gl.deleteVertexArray(res.probeVAO)
  gl.deleteVertexArray(res.blitVAO)
  gl.deleteFramebuffer(res.fbo)
  gl.deleteTexture(res.texture)
}

/* ─── The prerender pass, and the measurement that is the whole ticket ──────── */

const BLEND_EQUATION_NAMES: Record<number, string> = {
  0x8006: "FUNC_ADD",
  0x8007: "MIN",
  0x8008: "MAX",
  0x800a: "FUNC_SUBTRACT",
  0x800b: "FUNC_REVERSE_SUBTRACT",
}

const ERROR_NAMES: Record<number, string> = {
  0: "NO_ERROR",
  0x0500: "INVALID_ENUM",
  0x0501: "INVALID_VALUE",
  0x0502: "INVALID_OPERATION",
  0x0505: "OUT_OF_MEMORY",
  0x0506: "INVALID_FRAMEBUFFER_OPERATION",
}

const FRAMEBUFFER_STATUS_NAMES: Record<number, string> = {
  0x8cd5: "FRAMEBUFFER_COMPLETE",
  0x8cd6: "FRAMEBUFFER_INCOMPLETE_ATTACHMENT",
  0x8cd7: "FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT",
  0x8cdd: "FRAMEBUFFER_UNSUPPORTED",
  0x8d56: "FRAMEBUFFER_INCOMPLETE_MULTISAMPLE",
}

function name(table: Record<number, string>, value: number): string {
  return table[value] ?? `0x${value.toString(16)}`
}

export type ProbeReading = {
  /** Which `readPixels` combination the driver actually accepted. */
  readPath: string
  maxByte: number
  /** Non-zero mask values and how many pixels carry each. */
  histogram: Array<{ value: number; count: number }>
}

/**
 * `R8` readback, with the fallback the spec does not require but some drivers want.
 *
 * GLES3 guarantees `RGBA`/`UNSIGNED_BYTE` for any normalised fixed-point colour
 * buffer, so that is tried first and is what desktop and SwiftShader take. The
 * `RED`/`UNSIGNED_BYTE` retry exists because this spike's entire subject is drivers
 * behaving differently from the spec, and a readback that fails on the target device
 * would otherwise read as "`MAX` is broken" when it is only the readback that is.
 */
function readMaskRed(gl: WebGL2RenderingContext, width: number, height: number): { red: Uint8Array; path: string } {
  const pixels = width * height
  const rgba = new Uint8Array(pixels * 4)
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
  if (gl.getError() === gl.NO_ERROR) {
    const red = new Uint8Array(pixels)
    for (let i = 0; i < pixels; i++) red[i] = rgba[i * 4]
    return { red, path: "RGBA/UNSIGNED_BYTE" }
  }
  const red = new Uint8Array(pixels)
  gl.readPixels(0, 0, width, height, gl.RED, gl.UNSIGNED_BYTE, red)
  const error = gl.getError()
  return { red, path: error === gl.NO_ERROR ? "RED/UNSIGNED_BYTE" : `readPixels rejected (${name(ERROR_NAMES, error)})` }
}

function histogram(red: Uint8Array, path: string): ProbeReading {
  const counts = new Map<number, number>()
  let maxByte = 0
  for (const value of red) {
    if (value === 0) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
    if (value > maxByte) maxByte = value
  }
  return {
    readPath: path,
    maxByte,
    histogram: [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count),
  }
}

export type ProbeVerdict = "max" | "sum" | "overwrite" | "nothing-drawn" | "unclear"

/**
 * THE GO/NO-GO, DECIDED ON PIXEL COUNTS RATHER THAN PIXEL VALUES — and the reason is
 * worth writing down, because the obvious test does not work.
 *
 * The obvious test reads the overlap and checks it equals `max(a, b)`. But three
 * different GL behaviours produce three outcomes and only two of them are separable by
 * value alone:
 *
 * | behaviour                      | overlap | max byte seen | distinct values |
 * |--------------------------------|---------|---------------|-----------------|
 * | `MAX` honoured                 | 0.55    | 140           | {89, 140}       |
 * | additive blend                 | 0.90    | 229           | {89, 140, 229}  |
 * | blend ignored, last write wins | 0.35    | 140           | {89, 140}       |
 *
 * A sum is loud. **An ignored blend equation is silent**, and it is the failure mode
 * that would quietly destroy the union semantics D-020 rests on: twice-covered ground
 * rendering as whatever was drawn last. Rows 1 and 3 are indistinguishable by value.
 *
 * They are trivially separable by AREA. Both discs have the same radius, so with `MAX`
 * the high disc keeps all of its pixels and the low disc loses the overlap; with
 * last-write-wins it is the other way round. `count(high) > count(low)` is therefore
 * exactly "`MAX` was honoured", and it needs no knowledge of where on screen the two
 * discs landed — which is what makes it safe to run inside MapLibre's own projection.
 */
export function judgeProbe(reading: ProbeReading): { verdict: ProbeVerdict; detail: string } {
  const low = quantise(PROBE_LOW)
  const high = quantise(PROBE_HIGH)
  const summed = quantise(PROBE_LOW + PROBE_HIGH)
  // ±1 throughout: the float → unorm8 conversion is round-to-nearest and a driver is
  // allowed to land either side of a .5 tie.
  const near = (target: number) =>
    reading.histogram.filter((h) => Math.abs(h.value - target) <= 1).reduce((n, h) => n + h.count, 0)

  const lowCount = near(low)
  const highCount = near(high)
  const summedCount = near(summed)
  const counts = `low(${low})=${lowCount} high(${high})=${highCount} summed(${summed})=${summedCount} maxByte=${reading.maxByte}`

  if (summedCount > 0 || reading.maxByte > high + 1) {
    return { verdict: "sum", detail: `coverage ABOVE ${high} is present — the discs are being summed, not unioned. ${counts}` }
  }
  if (lowCount === 0 && highCount === 0) {
    return { verdict: "nothing-drawn", detail: `the mask is empty — the probe discs never reached it. ${counts}` }
  }
  if (lowCount === 0 || highCount === 0) {
    return { verdict: "unclear", detail: `only one of the two coverage values is present. ${counts}` }
  }
  if (highCount > lowCount) {
    return { verdict: "max", detail: `max(a, b) honoured: the high disc kept every pixel and the low disc lost the overlap. ${counts}` }
  }
  return {
    verdict: "overwrite",
    detail: `the blend equation is being IGNORED — the second draw overwrote the overlap. ${counts}`,
  }
}

export type RestoreCheck = {
  blendEquationRGB: string
  blendEquationAlpha: string
  framebufferUnbound: boolean
  viewport: string
  viewportRestored: boolean
}

export function restoreOk(r: RestoreCheck): boolean {
  return (
    r.blendEquationRGB === "FUNC_ADD" &&
    r.blendEquationAlpha === "FUNC_ADD" &&
    r.framebufferUnbound &&
    r.viewportRestored
  )
}

export type MaskPassResult = {
  probe: ProbeReading | null
  restore: RestoreCheck
  glError: string
}

/**
 * §4.2's pass, verbatim where it can be, inside MapLibre's `prerender`.
 *
 * `blendFunc(ONE, ONE)` is set even though GLES3 ignores the blend factors entirely
 * for `MIN` and `MAX`. It is in §4.2, it costs nothing, and a later session changing
 * the equation without noticing the factors were never set is a worse outcome than a
 * redundant call.
 *
 * The restore at the end is belt and braces and §4.2 says so: MapLibre calls
 * `setBaseState()` and `bindFramebuffer.set(null)` after both custom-layer hooks, so
 * it would recover on its own. Leaving `MAX` set anyway "is the kind of bug that shows
 * up three layers later as 'why is the basemap wrong'", and criterion 4 asks for proof
 * rather than for trust — hence the read-back rather than just the restore.
 */
export function runMaskPass(
  gl: WebGL2RenderingContext,
  res: MaskResources,
  projection: ProjectionLike,
  options: {
    probe: boolean
    /**
     * SELF-TEST ONLY, and `tools/spike-harness` is the only caller that passes it.
     *
     * A probe that can only report "max" is not a measurement, it is a decoration —
     * the same argument every `scripts/check-*.mjs --self-test` in this repo makes.
     * `"add"` forces `FUNC_ADD` and `"off"` disables blending entirely, so the harness
     * can prove `judgeProbe` actually returns `sum` and `overwrite` when it should.
     * Nothing in the app ever sets it.
     */
    blendOverride?: "add" | "off"
  },
): MaskPassResult {
  let pending = gl.getError() // drain, so the report below is about THIS pass

  const saved = Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array)

  gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo)
  gl.viewport(0, 0, res.maskW, res.maskH)
  gl.clearColor(0, 0, 0, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.disable(gl.DEPTH_TEST)
  if (options.blendOverride === "off") {
    gl.disable(gl.BLEND)
  } else {
    gl.enable(gl.BLEND)
    // union, not sum — WebGL2 only, and the whole question this ticket asks
    gl.blendEquation(options.blendOverride === "add" ? gl.FUNC_ADD : gl.MAX)
    gl.blendFunc(gl.ONE, gl.ONE)
  }

  gl.useProgram(res.maskProgram)
  setProjectionUniforms(gl, res.maskProgram, projection)

  let probe: ProbeReading | null = null
  if (options.probe) {
    // PROBE_HIGH is instance 0 and is therefore drawn FIRST. See judgeProbe: the draw
    // order is what makes an ignored blend equation detectable at all.
    gl.bindVertexArray(res.probeVAO)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 2)
    if (pending === gl.NO_ERROR) pending = gl.getError()
    const { red, path } = readMaskRed(gl, res.maskW, res.maskH)
    probe = histogram(red, path)
    gl.clear(gl.COLOR_BUFFER_BIT) // the probe is measurement, not scenery
  }

  gl.bindVertexArray(res.fieldVAO)
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, res.fieldCount)
  gl.bindVertexArray(null)

  gl.blendEquation(gl.FUNC_ADD)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(saved[0], saved[1], saved[2], saved[3])

  const after = Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array)
  const restore: RestoreCheck = {
    blendEquationRGB: name(BLEND_EQUATION_NAMES, gl.getParameter(gl.BLEND_EQUATION_RGB) as number),
    blendEquationAlpha: name(BLEND_EQUATION_NAMES, gl.getParameter(gl.BLEND_EQUATION_ALPHA) as number),
    framebufferUnbound: gl.getParameter(gl.FRAMEBUFFER_BINDING) === null,
    viewport: after.join(","),
    viewportRestored: after.join(",") === saved.join(","),
  }

  const error = gl.getError()
  return { probe, restore, glError: name(ERROR_NAMES, pending !== gl.NO_ERROR ? pending : error) }
}

/** The greyscale blit, in `render`, into MapLibre's own framebuffer. */
export function runBlitPass(gl: WebGL2RenderingContext, res: MaskResources): void {
  gl.useProgram(res.blitProgram)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, res.texture)
  const sampler = gl.getUniformLocation(res.blitProgram, "u_mask")
  if (sampler) gl.uniform1i(sampler, 0)
  gl.disable(gl.DEPTH_TEST)
  gl.enable(gl.BLEND)
  // Premultiplied, which is what MapLibre's render pass expects. BLIT_FRAGMENT_SOURCE
  // outputs vec4(rgb * a, a) to match.
  gl.blendEquation(gl.FUNC_ADD)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  gl.bindVertexArray(res.blitVAO)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  gl.bindVertexArray(null)
}

/* ─── Feature detection (criterion 6) and the verdict (criterion 7) ──────────── */

export type Capabilities = {
  renderer: string
  vendor: string
  glVersion: string
  shadingLanguage: string
  /** Criterion 6 names this extension. It is recorded, not required — see `detectCapabilities`. */
  colorBufferHalfFloat: boolean
  colorBufferFloat: boolean
  /** `checkFramebufferStatus` on a real `R8` attachment, by name. */
  r8Framebuffer: string
  maxTextureSize: number
}

/**
 * FEATURE-DETECTED AND RECORDED RATHER THAN ASSUMED, which is criterion 6 — with one
 * correction to the criterion's premise, worth stating because it changes what a
 * missing extension means.
 *
 * `EXT_color_buffer_half_float` has nothing to do with `R8`. In GLES3 / WebGL2 `R8` is
 * **core colour-renderable**, so the mask needs no extension at all; the half-float
 * extension would matter only if §4.2's mask were `R16F`, which it is not. So its
 * absence is NOT a NO-GO, and the thing that actually decides renderability is the
 * `checkFramebufferStatus` below. Both are reported so the record is honest either way.
 */
export function detectCapabilities(gl: WebGL2RenderingContext): Capabilities {
  const debug = gl.getExtension("WEBGL_debug_renderer_info")
  const texture = gl.createTexture()
  const fbo = gl.createFramebuffer()
  let status = 0
  if (texture && fbo) {
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 4, 4, 0, gl.RED, gl.UNSIGNED_BYTE, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.deleteFramebuffer(fbo)
    gl.deleteTexture(texture)
  }
  return {
    renderer: (debug ? (gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string) : null) ?? "(masked)",
    vendor: (debug ? (gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) as string) : null) ?? "(masked)",
    glVersion: gl.getParameter(gl.VERSION) as string,
    shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION) as string,
    colorBufferHalfFloat: gl.getExtension("EXT_color_buffer_half_float") !== null,
    colorBufferFloat: gl.getExtension("EXT_color_buffer_float") !== null,
    r8Framebuffer: name(FRAMEBUFFER_STATUS_NAMES, status),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
  }
}

export type SpikeVerdict = {
  capabilities: Capabilities | null
  instances: number
  maskSize: string
  probe: { verdict: ProbeVerdict; detail: string } | null
  readPath: string | null
  restore: RestoreCheck | null
  glError: string | null
  /** A compile or link failure, verbatim. Its presence is on its own a NO-GO. */
  shaderError: string | null
  userAgent: string
  devicePixelRatio: number
  /** Median frame interval over the last 60 frames. Informational — see `verdictFailures`. */
  frameMs: number | null
}

/**
 * Every reason this is not a GO, as sentences. Empty means GO.
 *
 * FRAME TIME IS DELIBERATELY NOT IN HERE. `0059` owns the §6.4 budget against a real
 * mid-range phone with the real cell count, and a spike drawing 471 flat discs has no
 * business pronouncing on perf. It is reported, and `formatVerdict` warns above 50 ms,
 * because "works but at four frames a second" belongs in the ticket's one paragraph —
 * but it is not what `MAX`-into-`R8` is being asked.
 */
export function verdictFailures(v: SpikeVerdict): string[] {
  const failures: string[] = []
  if (v.shaderError) failures.push(`shader did not build: ${v.shaderError}`)
  if (!v.capabilities) failures.push("no WebGL2 context")
  else if (v.capabilities.r8Framebuffer !== "FRAMEBUFFER_COMPLETE") {
    failures.push(`a half-res R8 framebuffer is not renderable here (${v.capabilities.r8Framebuffer})`)
  }
  if (!v.probe) failures.push("the MAX probe did not run")
  else if (v.probe.verdict !== "max") failures.push(`MAX is not being honoured — ${v.probe.verdict}: ${v.probe.detail}`)
  if (!v.restore) failures.push("GL state was never read back")
  else if (!restoreOk(v.restore)) {
    failures.push(
      `GL state not restored (blendEquation ${v.restore.blendEquationRGB}/${v.restore.blendEquationAlpha}, ` +
        `framebuffer ${v.restore.framebufferUnbound ? "unbound" : "STILL BOUND"}, ` +
        `viewport ${v.restore.viewportRestored ? "restored" : `wrong: ${v.restore.viewport}`})`,
    )
  }
  if (v.glError && v.glError !== "NO_ERROR") failures.push(`gl.getError() reported ${v.glError}`)
  return failures
}

export function overallVerdict(v: SpikeVerdict): "GO" | "NO-GO" {
  return verdictFailures(v).length === 0 ? "GO" : "NO-GO"
}

/**
 * The panel's text, and the paragraph that goes into
 * `docs/capabilities/08-map-and-fog-renderer.md`. One block, copy-pasteable, with the
 * device and the browser in it — criterion 7 asks for exactly that and asking anyone to
 * assemble it by hand from a screenshot is how a spike ends up recorded as "worked".
 */
export function formatVerdict(v: SpikeVerdict): string {
  const failures = verdictFailures(v)
  const lines: string[] = []
  lines.push(failures.length === 0 ? "GO" : `NO-GO — ${failures.length} problem${failures.length === 1 ? "" : "s"}`)
  for (const failure of failures) lines.push(`  ✗ ${failure}`)
  lines.push("")
  lines.push(`gpu        ${v.capabilities?.renderer ?? "—"}`)
  lines.push(`vendor     ${v.capabilities?.vendor ?? "—"}`)
  lines.push(`gl         ${v.capabilities?.glVersion ?? "—"}`)
  lines.push(`glsl       ${v.capabilities?.shadingLanguage ?? "—"}`)
  lines.push(`R8 fbo     ${v.capabilities?.r8Framebuffer ?? "—"}  (core in WebGL2; no extension needed)`)
  lines.push(
    `half-float ${v.capabilities ? (v.capabilities.colorBufferHalfFloat ? "present" : "absent") : "—"}` +
      `   float ${v.capabilities ? (v.capabilities.colorBufferFloat ? "present" : "absent") : "—"}` +
      `   — recorded, not required by an R8 mask`,
  )
  lines.push(`mask       ${v.maskSize} R8, LINEAR, CLAMP_TO_EDGE — half the drawing buffer`)
  lines.push(`draw       1 × drawArraysInstanced, ${v.instances} instances`)
  lines.push(`MAX probe  ${v.probe ? `${v.probe.verdict} — ${v.probe.detail}` : "—"}`)
  lines.push(`readback   ${v.readPath ?? "—"}`)
  lines.push(
    `restored   ${
      v.restore
        ? `blendEquation ${v.restore.blendEquationRGB}/${v.restore.blendEquationAlpha}, ` +
          `framebuffer ${v.restore.framebufferUnbound ? "null" : "STILL BOUND"}, viewport ${v.restore.viewport}`
        : "—"
    }`,
  )
  lines.push(`gl.getError ${v.glError ?? "—"}`)
  lines.push(
    `frame      ${v.frameMs === null ? "—" : `${v.frameMs.toFixed(1)} ms median`}` +
      `${v.frameMs !== null && v.frameMs > 50 ? "  ⚠ slow — informational only, 0059 owns the §6.4 budget" : ""}`,
  )
  lines.push(`dpr        ${v.devicePixelRatio}`)
  lines.push(`ua         ${v.userAgent}`)
  return lines.join("\n")
}
