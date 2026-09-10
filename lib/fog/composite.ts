/**
 * PASS 2 — THE NOISY COMPOSITE. Ticket `0056`. `05-fog-of-war.md` §4.3, §4.5.
 *
 * MapLibre calls `render` during its translucent pass. We draw **one full-screen triangle** into
 * MapLibre's own framebuffer, sample `0055`'s half-resolution `R8` coverage mask, and threshold it
 * with a `smoothstep` whose cut point is perturbed by animated 3-octave value-noise fBm — plus a
 * warm rim glow where the threshold is being crossed.
 *
 * A TRIANGLE AND NOT A QUAD. Two triangles meet along a diagonal, and a fragment exactly on that
 * seam is rasterised by neither or both depending on the driver's fill rule; a single oversized
 * triangle clipped to the viewport has no interior edge at all, and does one vertex less work.
 *
 * ─── ONE IMPORT, AND THE HARNESS KNOWS ABOUT IT ─────────────────────────────
 *
 * `mask.ts` has zero imports so `tools/fog-harness` can compile it alone and drive it against a
 * real WebGL2 context. This file keeps that property with one exception — `fog-uniforms.ts`, which
 * is constants only — and `run.mjs` strips `import` lines and concatenates the modules into one
 * script scope to preserve it. The rule is unchanged in substance: **nothing here may import
 * anything that needs a DOM, MapLibre, or a bundler.** The GPU claims this file makes are the ones
 * a fake GL context provably cannot make.
 *
 * ─── D-233: THE NOISE IS ANCHORED TO THE GROUND, NOT TO THE SCREEN ──────────
 *
 * §4.3's shader sketch computes `vec2 q = uv * u_screen / 260.0` — **screen space**. That is the
 * defect this ticket's own Notes describe (*"the classic mistake here: it looks fine on a still map
 * and crawls distractingly the moment you pan"*) and the defect criterion 9 forbids, written into
 * the design document as the recipe. Shipping it would have passed every test in the suite and
 * failed on sight, which is the same shape as `0055`'s seam.
 *
 * So the fragment shader unprojects instead. `defaultProjectionData.mainMatrix` maps mercator
 * `(x, y, 0, 1)` to clip; dropping its Z column leaves a 3x3 homography, and the ground plane under
 * a mercator camera is exactly a homography away from the screen however the camera is pitched or
 * rotated. `noiseFrame()` inverts it on the CPU in double precision and folds the noise scale and
 * lattice origin into the same matrix, so the fragment shader does one interpolated divide and gets
 * a noise coordinate that is a **property of the ground**. Pan, and the mist stays where it was.
 *
 * See `noiseFrame` for why the origin exists and what it costs.
 */

import {
  FBM_LACUNARITY,
  FBM_OCTAVES,
  NOISE_DRIFT_1,
  NOISE_DRIFT_2,
  NOISE_FIELD_2_FREQ,
  NOISE_FIELD_MIX,
  NOISE_ORIGIN_MODULUS,
  NOISE_PX,
  OCTAVE_JITTER,
  REVEAL_HI,
  REVEAL_LO,
  type FogPalette,
} from "./fog-uniforms"

/* ─── Shaders ───────────────────────────────────────────────────────────────── */

/**
 * The full-screen triangle, from `gl_VertexID` alone — no buffer, no attributes, no VAO contents.
 *
 * `v_noiseH` is the noise coordinate in HOMOGENEOUS form and the divide happens in the fragment
 * shader. That is not an optimisation, it is correctness: `u_noiseMatrix` is projective, so the
 * mapping from screen to ground is not linear once the camera is pitched. All three vertices carry
 * `w = 1`, so the varying interpolates exactly linearly in NDC — which is precisely the quantity
 * the matrix is linear in — and the per-fragment divide supplies the projective part.
 */
export const COMPOSITE_VERTEX_SOURCE = `#version 300 es
precision highp float;

uniform mat3 u_noiseMatrix;   // NDC -> noise coords, homogeneous

out vec2 v_uv;
out vec3 v_noiseH;

void main() {
    vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
    v_uv = (p + 1.0) * 0.5;
    v_noiseH = u_noiseMatrix * vec3(p, 1.0);
    gl_Position = vec4(p, 0.0, 1.0);
}`

/**
 * How far the lattice cell index is shifted before it is reinterpreted as unsigned, so a cell just
 * left of or below mercator zero never reaches the hash as a negative number. A pure translation of
 * an infinite lattice, so it changes which noise you see and nothing else.
 *
 * The bound it has to clear: the largest local coordinate the shader ever floors is the screen
 * half-width in noise cells (~8) times the largest octave multiplier (12), plus the octave jitter,
 * plus the animation drift — and the drift is what actually grows, at 0.021 cells/second times 12.
 * `TIME_WRAP_S` caps that at 24 hours, i.e. ~22,000. 65,536 clears it with room to spare and is
 * still small enough to leave the origin its full headroom under 2^24.
 */
export const CELL_BIAS = 65536

/**
 * `u_time` is wrapped at 24 hours before it reaches the shader. Two reasons, and neither is
 * precision: a `float` still resolves a microsecond at 86,400. It is the LATTICE INDEX that grows —
 * `drift x time x octave` — and it has to stay inside `CELL_BIAS`. The discontinuity is a single
 * jump in the drift phase, once, in a tab that has been open for a day.
 */
export const TIME_WRAP_S = 86_400

/**
 * §4.3's composite, with three deliberate divergences from the sketch, all of them D-233:
 *
 *  1. **The noise coordinate is ground-anchored** (see this module's header). `u_screen` is gone
 *     with it — `v_uv` comes from the triangle, which is cheaper and exact.
 *  2. **The hash is integer, not `sin`-based.** `fract(sin(dot(p, k)) * 43758.5453)` is fine while
 *     `p` is a screen coordinate under a few thousand. Anchored to the ground, `p` is a lattice
 *     index that reaches ~2 million at z18, `dot` reaches 1e8, and a `float` quantises that to
 *     multiples of 4 — so whole runs of adjacent cells collapse onto one hash value and the field
 *     visibly repeats. An integer bit-mix is exact for every index the lattice can produce, and it
 *     is cheaper than `sin` on most mobile GPUs besides.
 *  3. **Lacunarity 2.0 with a per-octave integer jitter**, rather than 2.03. `FBM_LACUNARITY`
 *     explains why: the integer origin has to survive being multiplied by it.
 *
 * Everything else — the two drifting fields, the mix, the reveal ramp, the rim's
 * `reveal * (1 - reveal) * 4`, the premultiplied output — is §4.3 unchanged.
 */
export function compositeFragmentSource(octaves: number = FBM_OCTAVES): string {
  return `#version 300 es
precision highp float;

#define FBM_OCTAVES ${Math.max(1, Math.floor(octaves))}

uniform sampler2D u_mask;
uniform vec2  u_noiseOrigin;   // integer lattice origin, re-added inside the hash
uniform float u_time;          // seconds, wrapped at ${TIME_WRAP_S}
uniform vec3  u_fogDeep;
uniform vec3  u_fogEdge;
uniform vec3  u_rimGlow;
uniform float u_maxOpacity;
uniform float u_noiseAmp;
uniform float u_rimAmt;

in  vec2 v_uv;
in  vec3 v_noiseH;
out vec4 fragColor;

// A bit-mix over the EXACT integer lattice cell. See divergence 2 in this function's doc comment.
float hashCell(vec2 cell) {
    uvec2 c = uvec2(cell + ${CELL_BIAS}.0);
    uint h = c.x * 0x27d4eb2du ^ (c.y + 0x9e3779b9u) * 0x85ebca6bu;
    h ^= h >> 15; h *= 0x2545f491u; h ^= h >> 13; h *= 0x27d4eb2du; h ^= h >> 16;
    return float(h) * (1.0 / 4294967296.0);
}

// \`p\` is small and local; \`o\` is the large integer origin and is added AFTER the floor, so the
// fractional interpolant never loses precision to the magnitude of the world coordinate.
float vnoise(vec2 p, vec2 o) {
    vec2 i = floor(p) + o;
    vec2 f = fract(p);
    vec2 w = f * f * (3.0 - 2.0 * f);
    return mix(mix(hashCell(i + vec2(0.0, 0.0)), hashCell(i + vec2(1.0, 0.0)), w.x),
               mix(hashCell(i + vec2(0.0, 1.0)), hashCell(i + vec2(1.0, 1.0)), w.x), w.y);
}

float fbm(vec2 p, vec2 o) {
    float v = 0.0;
    float a = 0.5;
    for (int k = 0; k < FBM_OCTAVES; k++) {
        v += a * vnoise(p, o + vec2(${OCTAVE_JITTER[0]}.0, ${OCTAVE_JITTER[1]}.0) * float(k));
        p *= ${FBM_LACUNARITY.toFixed(1)};
        o *= ${FBM_LACUNARITY.toFixed(1)};
        a *= 0.5;
    }
    return v;
}

void main() {
    float coverage = texture(u_mask, v_uv).r;

    // The projective divide. Ground coordinates in noise cells, local to this frame's origin.
    vec2 q = v_noiseH.xy / v_noiseH.z;

    // Two fields drifting at different speeds and scales: the slow one shapes the boundary, the
    // fast one animates wisps. The drift is added to the LOCAL coordinate, so the field slides
    // over ground that is itself standing still.
    float n1 = fbm(q + vec2(${NOISE_DRIFT_1[0]}, ${NOISE_DRIFT_1[1]}) * u_time, u_noiseOrigin);
    float n2 = fbm(q * ${NOISE_FIELD_2_FREQ.toFixed(1)} + vec2(${NOISE_DRIFT_2[0]}, ${NOISE_DRIFT_2[1]}) * u_time,
                   u_noiseOrigin * ${NOISE_FIELD_2_FREQ.toFixed(1)});
    float n  = mix(n1, n2, ${NOISE_FIELD_MIX});

    // Perturb the reveal threshold => a ragged, organic mist edge instead of a blurred blob.
    float reveal = smoothstep(${REVEAL_LO}, ${REVEAL_HI}, coverage + (n - 0.5) * u_noiseAmp);

    float alpha = (1.0 - reveal) * u_maxOpacity;

    // Density variation INSIDE the fog, so it is not a flat wash.
    vec3 col = mix(u_fogDeep, u_fogEdge, smoothstep(0.25, 0.85, n));

    // Rim: peaks where the threshold is being crossed and is exactly zero on both sides. This is
    // the "torchlight at the edge of the known world" beat. Keep it subtle.
    float rim = reveal * (1.0 - reveal) * 4.0;
    col += u_rimGlow * rim * u_rimAmt;
    alpha = max(alpha, rim * 0.10);   // a faint glow bleeding into cleared ground

    fragColor = vec4(col * alpha, alpha);   // premultiplied — MapLibre's default blend
}`
}

/* ─── The noise frame: screen -> ground, on the CPU, in double precision ────── */

/** What one frame's ground anchoring needs. All of it derived from `mainMatrix` and the viewport. */
export interface NoiseFrame {
  /** NDC -> noise coordinates, homogeneous, column-major for `uniformMatrix3fv`. */
  matrix: Float32Array
  /** The integer lattice origin, exactly representable in a `float`. */
  origin: [number, number]
  /** Noise cells per mercator unit. Diagnostic; the matrix already carries it. */
  scale: number
  /** Mercator units per drawing-buffer pixel at the screen centre. Diagnostic. */
  mercPerPixel: number
  /** True when `mainMatrix` was singular and the screen-space fallback was used. */
  degenerate: boolean
}

/** `mainMatrix` is column-major, so element `(row, col)` is `m[col * 4 + row]`. */
function at(m: ArrayLike<number>, row: number, col: number): number {
  return m[col * 4 + row] ?? 0
}

/** `a` is row-major 3x3 as `[r0c0, r0c1, r0c2, r1c0, ...]`. Returns row-major, or null if singular. */
function invert3(a: readonly number[]): number[] | null {
  const [a00, a01, a02, a10, a11, a12, a20, a21, a22] = a as [
    number, number, number, number, number, number, number, number, number,
  ]
  const c00 = a11 * a22 - a12 * a21
  const c01 = a02 * a21 - a01 * a22
  const c02 = a01 * a12 - a02 * a11
  const det = a00 * c00 + a10 * c01 + a20 * c02
  if (!Number.isFinite(det) || Math.abs(det) < 1e-30) return null
  const inv = 1 / det
  return [
    c00 * inv,
    c01 * inv,
    c02 * inv,
    (a12 * a20 - a10 * a22) * inv,
    (a00 * a22 - a02 * a20) * inv,
    (a02 * a10 - a00 * a12) * inv,
    (a10 * a21 - a11 * a20) * inv,
    (a01 * a20 - a00 * a21) * inv,
    (a00 * a11 - a01 * a10) * inv,
  ]
}

/** Apply a row-major 3x3 to `(x, y, 1)` and divide through. */
function applyHomog(m: readonly number[], x: number, y: number): [number, number] {
  const w = m[6]! * x + m[7]! * y + m[8]!
  if (w === 0 || !Number.isFinite(w)) return [NaN, NaN]
  return [(m[0]! * x + m[1]! * y + m[2]!) / w, (m[3]! * x + m[4]! * y + m[5]!) / w]
}

/**
 * BUILD ONE FRAME'S GROUND ANCHORING. D-233, and the whole of criterion 9 lives here.
 *
 * ─── WHY THERE IS AN ORIGIN AT ALL ──────────────────────────────────────────
 *
 * Anchoring the noise to the ground means the noise coordinate is `mercator x scale`, and `scale`
 * grows with zoom: a noise cell is `NOISE_PX` screen pixels, and at z18 on a DPR-2 display the map
 * is half a billion pixels wide, so the coordinate reaches ~2 million. A `float` has 24 bits of
 * mantissa. At 2 million, `fract()` resolves to 1/8 of a cell — a 32-pixel staircase in what is
 * supposed to be a smooth gradient — and the third octave, twelve times further out, is blocky.
 *
 * The fix is to keep the coordinate the shader interpolates SMALL and hand the large part over
 * separately as an exact integer:
 *
 *     absolute noise coordinate  =  local coordinate (|q| < ~10, full precision)
 *                                +  origin           (integer, added after the floor)
 *
 * The origin is `floor(centre x scale)`, so it changes by whole cells as the camera pans — and
 * because it is added after `floor(p)`, the ABSOLUTE cell index is unchanged when it does. No pop.
 * The same holds through a zoom: `scale` moves continuously, the origin jumps, the sum does not.
 * `composite.test.ts` asserts exactly that, on both.
 *
 * The subtraction of the origin happens HERE, in a double, folded into the matrix — which is the
 * point. Done in the shader it would be `float(2000000.4) - float(2000000.0)`, and catastrophic
 * cancellation would give back the staircase it was meant to remove.
 *
 * ─── THE FALLBACK ───────────────────────────────────────────────────────────
 *
 * A singular matrix means no ground plane to anchor to — MapLibre hands one out during style
 * transitions. Falling back to §4.3's original screen-space noise for that frame is a crawl nobody
 * will see; returning nothing would be a frame with no fog, which everybody would.
 */
export function noiseFrame(
  mainMatrix: ArrayLike<number>,
  width: number,
  height: number,
): NoiseFrame {
  const screenNoise = (): NoiseFrame => {
    // §4.3's original, as a fallback: NDC -> screen pixels / NOISE_PX, no ground anchoring.
    const sx = width / (2 * NOISE_PX)
    const sy = height / (2 * NOISE_PX)
    return {
      matrix: new Float32Array([sx, 0, 0, 0, sy, 0, 0, 0, 1]),
      origin: [0, 0],
      scale: 0,
      mercPerPixel: 0,
      degenerate: true,
    }
  }

  // The mercator plane's own 3x3: drop the Z column, since every point we care about has z = 0.
  const a = [
    at(mainMatrix, 0, 0), at(mainMatrix, 0, 1), at(mainMatrix, 0, 3),
    at(mainMatrix, 1, 0), at(mainMatrix, 1, 1), at(mainMatrix, 1, 3),
    at(mainMatrix, 3, 0), at(mainMatrix, 3, 1), at(mainMatrix, 3, 3),
  ]
  const ainv = invert3(a)
  if (!ainv || width <= 0 || height <= 0) return screenNoise()

  // Ground scale measured at the screen centre, one pixel apart. Under pitch the scale varies
  // across the screen and the homography handles that; this only sets the reference frequency.
  const [cx, cy] = applyHomog(ainv, 0, 0)
  const [px, py] = applyHomog(ainv, 2 / width, 0)
  const mercPerPixel = Math.hypot(px - cx, py - cy)
  if (!Number.isFinite(mercPerPixel) || mercPerPixel <= 0 || !Number.isFinite(cx)) {
    return screenNoise()
  }

  const scale = 1 / (mercPerPixel * NOISE_PX)
  const wrap = (v: number) => ((Math.floor(v) % NOISE_ORIGIN_MODULUS) + NOISE_ORIGIN_MODULUS) % NOISE_ORIGIN_MODULUS
  const origin: [number, number] = [wrap(cx * scale), wrap(cy * scale)]

  // N = S . Ainv, where S scales mercator into noise cells and subtracts the origin. Row-major.
  const n = [
    scale * ainv[0]! - origin[0] * ainv[6]!,
    scale * ainv[1]! - origin[0] * ainv[7]!,
    scale * ainv[2]! - origin[0] * ainv[8]!,
    scale * ainv[3]! - origin[1] * ainv[6]!,
    scale * ainv[4]! - origin[1] * ainv[7]!,
    scale * ainv[5]! - origin[1] * ainv[8]!,
    ainv[6]!,
    ainv[7]!,
    ainv[8]!,
  ]

  return {
    // Column-major for GLSL: uniformMatrix3fv with transpose = false.
    matrix: new Float32Array([n[0]!, n[3]!, n[6]!, n[1]!, n[4]!, n[7]!, n[2]!, n[5]!, n[8]!]),
    origin,
    scale,
    mercPerPixel,
    degenerate: false,
  }
}

/**
 * The absolute noise coordinate of one mercator point under one frame — what the shader computes,
 * computed here instead.
 *
 * TEST-ONLY, AND IT IS CRITERION 9's INSTRUMENT. Two frames related by a pan must agree on this
 * for the same ground point; a screen-space field cannot. Nothing on the frame path calls it.
 */
export function groundNoiseCoord(frame: NoiseFrame, mercX: number, mercY: number): [number, number] {
  return [mercX * frame.scale, mercY * frame.scale]
}

/* ─── GL resources ──────────────────────────────────────────────────────────── */

export interface CompositeResources {
  program: WebGLProgram
  /** Empty — the triangle comes from `gl_VertexID`. WebGL2 still requires a bound VAO to draw. */
  vao: WebGLVertexArrayObject
  uniforms: Record<string, WebGLUniformLocation | null>
  octaves: number
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error("createShader returned null")
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? "(no log)"
    gl.deleteShader(shader)
    throw new Error(`composite ${type === gl.VERTEX_SHADER ? "vertex" : "fragment"} shader: ${info}`)
  }
  return shader
}

/** Every uniform the composite declares. Cached at link time; `getUniformLocation` is not free. */
const UNIFORM_NAMES = [
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
] as const

export function createCompositeResources(
  gl: WebGL2RenderingContext,
  options: { octaves?: number } = {},
): CompositeResources {
  const octaves = options.octaves ?? FBM_OCTAVES
  const vs = compile(gl, gl.VERTEX_SHADER, COMPOSITE_VERTEX_SOURCE)
  const fs = compile(gl, gl.FRAGMENT_SHADER, compositeFragmentSource(octaves))
  const program = gl.createProgram()
  if (!program) throw new Error("createProgram returned null")
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? "(no log)"
    gl.deleteProgram(program)
    throw new Error(`composite program link: ${info}`)
  }
  const vao = gl.createVertexArray()
  if (!vao) throw new Error("createVertexArray returned null")

  const uniforms: Record<string, WebGLUniformLocation | null> = {}
  for (const name of UNIFORM_NAMES) uniforms[name] = gl.getUniformLocation(program, name)

  return { program, vao, uniforms, octaves }
}

export function disposeCompositeResources(
  gl: WebGL2RenderingContext,
  res: CompositeResources,
): void {
  gl.deleteProgram(res.program)
  gl.deleteVertexArray(res.vao)
}

/* ─── The render pass ───────────────────────────────────────────────────────── */

/** What `runCompositePass` put back, read from the driver rather than assumed. Criterion 1. */
export interface CompositeRestore {
  blendEquationRGB: number
  blendSrcRGB: number
  blendDstRGB: number
  framebufferUnbound: boolean
}

/** MapLibre's own base state for the translucent pass, which is what this pass must leave behind. */
export function compositeRestoreOk(gl: WebGL2RenderingContext, r: CompositeRestore): boolean {
  return (
    r.blendEquationRGB === gl.FUNC_ADD &&
    r.blendSrcRGB === gl.ONE &&
    r.blendDstRGB === gl.ONE_MINUS_SRC_ALPHA &&
    r.framebufferUnbound
  )
}

export interface CompositeFrame {
  mask: WebGLTexture
  noise: NoiseFrame
  /** Seconds since the layer started animating; 0 under reduced motion (§4.5). */
  time: number
  palette: FogPalette
}

/**
 * §4.3's pass, inside MapLibre's `render`.
 *
 * PREMULTIPLIED ALPHA, AND IT IS LOAD-BEARING (`0118` finding 3). MapLibre's translucent pass runs
 * `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`, so the shader emits `vec4(rgb * a, a)`. Emitting
 * straight alpha here would look approximately right over dark ground and wrong everywhere else.
 *
 * THE RESTORE IS BELT AND BRACES, exactly as `runMaskPass`'s is. MapLibre calls `setBaseState()`
 * after the custom-layer hooks and would recover on its own; the read-back exists because criterion
 * 1 asks for proof rather than for trust, and because a bound texture left on unit 0 is the kind of
 * thing that surfaces three layers later as "why is the basemap wrong".
 */
export function runCompositePass(
  gl: WebGL2RenderingContext,
  res: CompositeResources,
  frame: CompositeFrame,
): CompositeRestore {
  const u = res.uniforms
  gl.useProgram(res.program)

  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, frame.mask)
  if (u.u_mask) gl.uniform1i(u.u_mask, 0)

  if (u.u_noiseMatrix) gl.uniformMatrix3fv(u.u_noiseMatrix, false, frame.noise.matrix)
  if (u.u_noiseOrigin) gl.uniform2f(u.u_noiseOrigin, frame.noise.origin[0], frame.noise.origin[1])
  if (u.u_time) gl.uniform1f(u.u_time, frame.time % TIME_WRAP_S)

  const p = frame.palette
  if (u.u_fogDeep) gl.uniform3f(u.u_fogDeep, p.fogDeep[0], p.fogDeep[1], p.fogDeep[2])
  if (u.u_fogEdge) gl.uniform3f(u.u_fogEdge, p.fogEdge[0], p.fogEdge[1], p.fogEdge[2])
  if (u.u_rimGlow) gl.uniform3f(u.u_rimGlow, p.rimGlow[0], p.rimGlow[1], p.rimGlow[2])
  if (u.u_maxOpacity) gl.uniform1f(u.u_maxOpacity, p.maxOpacity)
  if (u.u_noiseAmp) gl.uniform1f(u.u_noiseAmp, p.noiseAmp)
  if (u.u_rimAmt) gl.uniform1f(u.u_rimAmt, p.rimAmt)

  gl.disable(gl.DEPTH_TEST)
  gl.enable(gl.BLEND)
  gl.blendEquation(gl.FUNC_ADD)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

  gl.bindVertexArray(res.vao)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  gl.bindVertexArray(null)
  gl.bindTexture(gl.TEXTURE_2D, null)

  return {
    blendEquationRGB: gl.getParameter(gl.BLEND_EQUATION_RGB) as number,
    blendSrcRGB: gl.getParameter(gl.BLEND_SRC_RGB) as number,
    blendDstRGB: gl.getParameter(gl.BLEND_DST_RGB) as number,
    framebufferUnbound: gl.getParameter(gl.FRAMEBUFFER_BINDING) === null,
  }
}
