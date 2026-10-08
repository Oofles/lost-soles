/**
 * PASS 1 — THE COVERAGE MASK. Ticket `0055`. `05-fog-of-war.md` §4.1, §4.2, §6.1.
 *
 * MapLibre calls `prerender` during its offscreen pass. We bind our own half-resolution
 * single-channel `R8` framebuffer, clear it to 0, and splat every visible explored cell as
 * a soft radial disc in **one** `drawArraysInstanced`, unioned with `gl.blendEquation(gl.MAX)`.
 * `0056` reads the resulting texture and composites the actual fog; until then the only way
 * to see this pass is the debug blit at the bottom of this file.
 *
 * ─── ZERO IMPORTS, ON PURPOSE ───────────────────────────────────────────────
 *
 * The same constraint `0118`'s spike module carried, kept for the same reason: `tools/fog-harness`
 * compiles this file ALONE with `tsc` and drives it against a bare WebGL2 canvas in headless
 * Chromium. That is how the two claims which are genuinely about rasterisation — that `a_fraction`
 * dims a coarse cell rather than leaving it solid, and that discs at `REVEAL_SCALE` merge without
 * scalloping — get proved numerically instead of by eye. h3-js and the mercator arithmetic live
 * one module away in `instances.ts`, and the instance data arrives here as a `Float32Array`.
 *
 * ─── WHAT `0118` PROVED, SO THIS FILE DOES NOT RE-ASK IT ────────────────────
 *
 * `gl.MAX` into a half-res `R8` FBO inside `prerender` works, and GL state can be restored out of
 * it cleanly (D-230; `docs/capabilities/08-map-and-fog-renderer.md`). What that spike did NOT do —
 * deliberately, because a flat disc writes one exact byte and its verdict compared integers — is
 * the soft falloff. That is §4.1's whole argument and it is this ticket's.
 */

/* ─── Geometry (§4.1) ───────────────────────────────────────────────────────── */

/**
 * `revealScale`. §4.1: the disc radius is **1.35 × the cell circumradius**, so at res 11 (D-237) that
 * is 1.35 × 28.7 ≈ 38.7 m against a 49.6 m centre-to-centre spacing (res 10's 102 m against 131.4 m
 * in §4.1's own prose — the ratio is what matters) — every neighbour's disc overlaps
 * yours well past its half-power point, and a contiguous run of cells becomes one region with no
 * seams.
 *
 * THE BOUNDS ARE R4'S AND THEY ARE A SCHEDULE ASSET — do not re-derive them by eye:
 *
 *   below ~1.15   scalloping appears between neighbours — the repeating semicircular notch
 *   above ~1.6    the territory looks inflated and imprecise, and stops meaning "where I ran"
 *
 * IT LIVES HERE AND NOT UNDER `src/`, and `scripts/check-fog-render-boundary.mjs` enforces that.
 * `REVEAL_R_M = 65` in `src/domain/fog.ts` decides what is explored, permanently, under D-020.
 * This number is a look, it is tuned by eye, and it will be tuned again (`0119`). If the two ever
 * meet, an art-direction tweak silently rewrites what counts as explored — and the map never
 * re-fogs, so that mistake is not recoverable by editing the constant back.
 */
export const REVEAL_SCALE = 1.35

/** §4.1's lower bound. Exported so the test asserting `REVEAL_SCALE` is inside it cannot drift. */
export const REVEAL_SCALE_MIN = 1.15
/** §4.1's upper bound. */
export const REVEAL_SCALE_MAX = 1.6

/**
 * WHERE THE DISC STOPS BEING SOLID AND STARTS FADING, as a fraction of the radius. **D-231.**
 *
 * §4.2 shipped this as `0.45` and it was wrong, in a way only a person looking at a real corridor
 * could have caught. The arithmetic:
 *
 *   adjacent H3 res-10 centres are 131.4 m apart, so their midpoint is 65.7 m from each
 *   the disc radius is 1.35 x 75.9 = 102.5 m, so that midpoint sits at 0.64 of the radius
 *   0.64 is OUTSIDE a flat core of 0.45 — it is a third of the way up the ramp
 *
 * So every junction between two adjacent cells dipped to **0.72 of peak**, and a run's corridor
 * rendered as a chain of discs with a visible crease at each join rather than as one region. That is
 * precisely the scalloping §4.1 promises 1.35 removes; the scale was never the problem.
 *
 * **`0056` WOULD HAVE MADE IT WORSE, NOT HIDDEN IT** — which is the part worth keeping. §4.3
 * thresholds at `smoothstep(0.30, 0.72, coverage + noise)` with the noise swinging +-0.15, so a seam
 * needs **>= 0.87** coverage to stay fully revealed at every phase of the animation. At 0.72 the
 * seams sat exactly ON the upper threshold and would have pulsed in and out of the mist as the noise
 * drifted: a chain of breathing pinch points along every route, diagnosable as a noise bug for as
 * long as anyone cared to look in the wrong place.
 *
 * At **0.60** the seam measures **0.98** on a real GPU — a flat interior with genuine margin — while
 * 40% of the radius stays feather. Going further costs `0056` its wisps for nothing: the noise
 * displaces the boundary by roughly `amplitude x (1 - inner) x radius`, so a steeper ramp moves the
 * edge less, and the seam is already saturated by 0.65.
 *
 * **THE DISC RADIUS IS UNCHANGED AND SO IS THE GROUND REVEALED.** This is the shape of the ramp
 * inside a disc that still ends at 102.5 m. `REVEAL_R_M` in `src/domain/fog.ts` — what counts as
 * explored, permanently, under D-020 — is a different number in a different file and is not touched.
 */
export const FALLOFF_INNER = 0.6

/**
 * The floor a seam must clear to stay fully revealed under `0056`'s animated threshold, derived from
 * §4.3's own constants rather than chosen: `smoothstep(0.30, 0.72, coverage + (n - 0.5) * 0.30)`
 * puts the worst-case noise at `-0.15`, so `coverage - 0.15 >= 0.72`.
 *
 * IT EXISTS AS A CONSTANT BECAUSE THE PREVIOUS THRESHOLD WAS INVENTED. `tools/fog-harness` asserted
 * `seam >= 179/255` — a number picked to sit clearly above the sabotage case, related to nothing —
 * and it passed the 0.72 seam that a person then reported as broken on sight. A threshold that comes
 * from the consuming pass cannot be calibrated to whatever the code currently does.
 */
export const SEAM_FLOOR = 0.87

/**
 * §4.2 — the mask is allocated at **half** the drawing buffer, and that is both cheaper and
 * *better*: the bilinear upsample in `0056`'s composite contributes a free extra feather (R4 §7.2).
 */
export const MASK_SCALE = 0.5

/**
 * Floats per instance: `centerMercX`, `centerMercY`, `radiusMerc`, `fraction`, `arc`. Criterion 5,
 * plus `0079`'s fifth.
 *
 * `arc` is the REVEAL SEAM (`0079`, `06-ui-ux.md` §3.2 beat 1). Every producer outside a reveal
 * writes `ARC_ALWAYS`, and an `ARC_ALWAYS` instance is weighted by exactly `1.0` — so the steady
 * state draws the same bytes it drew when the layout had four floats. Only `reveal-tag.ts` writes
 * anything else.
 */
export const INSTANCE_FLOATS = 5

/** `arc` for an instance that is not part of a reveal: always drawn, at full weight. */
export const ARC_ALWAYS = -1

/**
 * Added to `arc` for an instance that is drawn UNTIL its reveal position has fully arrived, and then
 * not at all — the pre-run stream's instances that the post-run stream replaces. `reveal-tag.ts`
 * explains which those are. Any `arc >= ARC_OUT_OFFSET - 0.5` is read as one.
 */
export const ARC_OUT_OFFSET = 2

/**
 * THE RAMP, as a fraction of the whole route. `0079`: *"a short ramp so the edge softens in rather
 * than popping"*.
 *
 * A cell at arc `a` starts at `p = a x (1 - R)` and is at full weight by `p = a x (1 - R) + R`.
 * Compressing the starts into `[0, 1 - R]` is what makes BOTH ends exact rather than approximately
 * right: at `p = 0` every start is `>= 0`, so every reveal weight is exactly 0; at `p = 1` the shader
 * short-circuits to exactly `1.0`. That pair is the ticket's safety property — the animation cannot
 * leave the map in a state the steady-state renderer would not have produced.
 *
 * 0.03 of the route is ~90 m of a 3 km run and ~600 m of a 20 km one: a few cells' worth of feather
 * on the edge that is travelling, on top of the disc falloff each cell already has. Tuned by eye with
 * the scrub control; it is a look, and lives here for `REVEAL_SCALE`'s reason.
 */
export const REVEAL_RAMP = 0.03

/**
 * `0079`. THE SHADER'S REVEAL WEIGHT, IN JAVASCRIPT — the same branches as `maskVertexSource`'s
 * `revealed()` and its caller, for the tests and the GPU harness to compute what a pass SHOULD draw.
 * `mask.test.ts` holds the two to the same constants; the harness holds them to the same pixels.
 */
export function revealWeight(arc: number, progress: number): number {
  if (arc < 0) return 1
  const ramp = (a: number) => {
    if (progress >= 1) return 1
    const start = a * (1 - REVEAL_RAMP)
    return Math.min(1, Math.max(0, (progress - start) / REVEAL_RAMP))
  }
  if (arc < ARC_OUT_OFFSET - 0.5) return ramp(arc)
  return ramp(arc - ARC_OUT_OFFSET) >= 1 ? 0 : 1
}

/**
 * THE ORIGIN GRID, `0079`. `uploadInstances` snaps its origin DOWN to a multiple of this.
 *
 * `0200` took the first instance's centre as the origin. A reveal uploads a merged stream whose first
 * instance can differ from the steady state's first instance, and a different origin is a different
 * float32 rounding of the folded matrix — a sub-pixel shift that a zero-tolerance pixel diff (the
 * ticket's criterion 2) reports as a divergence. Snapped to a 2^-10 grid (~39 km at the equator), the
 * two streams for one viewport share an origin unless the first instances straddle a grid line.
 *
 * The precision `0200` bought is kept: a float32 centre minus a multiple of 2^-10 is exact (fewer
 * than 24 significant bits remain), and relative coordinates up to ~2^-9 keep the folded matrix's
 * translation terms within ~0.004 CSS px of exact at z17 — `0200` measured the stair at 4.5 px.
 */
export const ORIGIN_GRID = 2 ** -10

/* ─── Shaders ───────────────────────────────────────────────────────────────── */

/**
 * §4.2's vertex shader, with MapLibre's prelude injected rather than hard-coded.
 *
 * `shaderData.vertexShaderPrelude` declares the projection uniform block and defines
 * `vec4 projectTile(vec2)` — under mercator that is `u_projection_matrix * vec4(p, 0, 1)`, under
 * globe it is the sphere. Using it is what gives this layer globe projection and terrain support
 * for free, and it is why this shader must NOT declare `u_projection_matrix` itself.
 *
 * NOTHING IS PROJECTED IN JS. Criterion 7, and `05` §6.1's rule: never call `map.project()` or
 * `cellToBoundary` per frame. Each instance carries a mercator centre and a mercator radius packed
 * once per bucket; the vertex shader does all of the projection, every frame, on the GPU.
 * `lib/fog/no-per-frame-projection.test.ts` greps for the alternative.
 */
export function maskVertexSource(prelude: string, define: string): string {
  return `#version 300 es
${prelude}
${define}

in vec2  a_quad;      // unit quad corner, -1..1           (per-vertex, 4 verts)
uniform vec2 u_origin; // see MaskResources.origin — (0, 0) whenever it is folded into the matrix

in vec2  a_center;    // cell centre, RELATIVE to MaskResources.origin (per-instance)
in float a_radius;    // disc radius, mercator units       (per-instance)
in float a_fraction;  // 0..1 coverage weight              (per-instance)
in float a_arc;       // 0079: reveal position, ARC_ALWAYS outside a reveal (per-instance)

uniform float u_reveal; // 0079: revealProgress, 0..1. Exactly 1.0 whenever no reveal is running.

out vec2  v_uv;
out float v_fraction;
// 0079. The reveal weight for a cell at route position arc. See REVEAL_RAMP for why both ends are exact.
float revealed(float arc) {
    if (u_reveal >= 1.0) return 1.0;
    float start = arc * ${(1 - REVEAL_RAMP).toFixed(6)};
    return clamp((u_reveal - start) / ${REVEAL_RAMP.toFixed(6)}, 0.0, 1.0);
}

void main() {
    float w = 1.0;
    if (a_arc >= 0.0) {
        w = a_arc < ${(ARC_OUT_OFFSET - 0.5).toFixed(1)}
            ? revealed(a_arc)
            : (revealed(a_arc - ${ARC_OUT_OFFSET.toFixed(1)}) >= 1.0 ? 0.0 : 1.0);
    }
    v_uv = a_quad;
    // Exactly a_fraction whenever w is 1.0, which is every instance outside a reveal.
    v_fraction = a_fraction * w;
    if (w <= 0.0) {
        // Not yet revealed (or already replaced): every corner outside the clip volume, so the
        // instance produces no fragments at all rather than 4 fragments of zero under MAX.
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    // Offset in mercator space, then let MapLibre project. A mercator-space disc is still a
    // disc on screen, so no latitude correction is needed for the SHAPE; a_radius carries the
    // ground-size variation (see metresToMercator in instances.ts).
    gl_Position = projectTile(u_origin + a_center + a_quad * a_radius);
}`
}

/**
 * §4.2's fragment shader. **THIS is where the mist edge comes from** — it costs nothing and it is
 * why there is no blur pass anywhere in this design.
 *
 * `1.0 - smoothstep(FALLOFF_INNER, 1.0, d)` is a Gaussian-*like* ramp rather than an actual
 * Gaussian: `smoothstep` is a cubic Hermite, evaluated in one instruction, and it reaches exactly 0
 * at the quad's edge. A true `exp(-d²)` never does, so it would either clip visibly at the quad
 * boundary or need a larger quad for the same visual radius — more overdraw for a difference nobody
 * can see under `0056`'s noise.
 *
 * `a_fraction` MULTIPLIES the coverage (criterion 8, §6.1's last bullet). At the canonical res-11
 * bucket it is 1.0 and this is a no-op. At `0058`'s coarse buckets it is the explored fraction,
 * computed in the browser from the set it already holds (D-238) — never fetched from
 * `explored-agg.json` — so a res-6 parent the user has run 20% of is a dim glow — without it,
 * zooming out turns a sparse city into a solid slab.
 *
 * The `discard` is not decoration: the quad is square and the disc is round, so a quarter of every
 * instance's fragments are outside it. Discarding them keeps `MAX` from writing zeros into the
 * corners — harmless under `MAX`, but it also halves the blended fragments at ~2-4x overdraw.
 */
export const MASK_FRAGMENT_SOURCE = `#version 300 es
precision mediump float;

in  vec2  v_uv;
in  float v_fraction;
out vec4  fragColor;

void main() {
    float d = length(v_uv);
    if (d > 1.0) discard;                        // square quad, round disc
    float c = (1.0 - smoothstep(${FALLOFF_INNER.toFixed(2)}, 1.0, d)) * v_fraction;
    fragColor = vec4(c, 0.0, 0.0, 1.0);
}`

/** A full-screen triangle from `gl_VertexID` alone — no buffer, no attributes. */
export const DEBUG_VERTEX_SOURCE = `#version 300 es
out vec2 v_uv;
void main() {
    vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
    v_uv = (p + 1.0) * 0.5;
    gl_Position = vec4(p, 0.0, 1.0);
}`

/**
 * Criterion 10 — the debug greyscale blit. Off unless the flag is set; see `maskDebugEnabled`.
 *
 * PREMULTIPLIED, AND THAT IS LOAD-BEARING (`0118` finding 3). MapLibre's `render` pass sets
 * `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`, so it expects premultiplied alpha and the output is
 * `vec4(rgb * a, a)` with alpha carrying the mask value. An opaque full-screen blit would satisfy
 * "the mask is visible" and break "the basemap renders unchanged" in the same frame.
 *
 * Dark rather than white because `0052` ships the stock Protomaps `light` flavour unmodified (the
 * parchment fork is capability 15) and a white veil on a pale basemap is exactly the ambiguity a
 * debug view must not produce — the operator is being asked to look for scalloping, which is a
 * shape question they cannot answer against low contrast.
 */
export const DEBUG_FRAGMENT_SOURCE = `#version 300 es
precision mediump float;

uniform sampler2D u_mask;

in  vec2 v_uv;
out vec4 fragColor;

void main() {
    float m = texture(u_mask, v_uv).r;
    fragColor = vec4(vec3(0.06) * m, m);   // premultiplied
}`

/**
 * The prelude a harness substitutes for MapLibre's. Behaviourally identical to MapLibre 6.6.0's
 * mercator prelude (`shaders.projectionMercator`), asserted byte-for-byte against the real one by
 * `tools/fog-harness/run-maplibre.mjs`, which compiles this shader against `shaderData` from a real
 * `Map`. Kept here rather than in the harness so the string this file is tested with and the string
 * the harness feeds it cannot drift.
 */
export const STUB_PRELUDE = `uniform mat4 u_projection_matrix;
vec4 projectTile(vec2 p) { return u_projection_matrix * vec4(p, 0.0, 1.0); }`

/* ─── Projection uniforms ───────────────────────────────────────────────────── */

/**
 * `CustomRenderMethodInput.defaultProjectionData`, structurally. Typed locally rather than imported
 * from `maplibre-gl` — see the header: this module stays import-free so it can run without MapLibre
 * at all. `mask-layer.ts` is where the real MapLibre type meets this one.
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
 * The six uniforms MapLibre's prelude declares, by the names its own type documentation gives them
 * (`0118` finding 1).
 *
 * EVERY `getUniformLocation` IS NULL-GUARDED, and that is not defensiveness. Under mercator the
 * globe uniforms are unused, so the GLSL compiler strips them and their locations come back null;
 * a harness's stub prelude declares only the one. Setting a null location is a documented no-op in
 * WebGL, but reading the location is not, and an unguarded `uniform4fv(null, …)` here would throw
 * inside `prerender` — i.e. inside MapLibre's own frame.
 */
export function setProjectionUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  p: ProjectionLike,
  origin: readonly [number, number] = [0, 0],
  foldOrigin = true,
): void {
  const at = (name: string) => gl.getUniformLocation(program, name)
  const matrix = at("u_projection_matrix")
  if (matrix) {
    gl.uniformMatrix4fv(matrix, false, foldOrigin ? translated(p.mainMatrix, origin) : new Float32Array(Array.from(p.mainMatrix)))
  }
  const shift = at("u_origin")
  if (shift) gl.uniform2f(shift, foldOrigin ? 0 : origin[0], foldOrigin ? 0 : origin[1])
  const fallback = at("u_projection_fallback_matrix")
  if (fallback) {
    gl.uniformMatrix4fv(fallback, false, new Float32Array(Array.from(p.fallbackMatrix)))
  }
  const tile = at("u_projection_tile_mercator_coords")
  if (tile) gl.uniform4fv(tile, p.tileMercatorCoords as unknown as number[])
  const plane = at("u_projection_clipping_plane")
  if (plane) gl.uniform4fv(plane, p.clippingPlane as unknown as number[])
  const transition = at("u_projection_transition")
  if (transition) gl.uniform1f(transition, p.projectionTransition)
  const antimeridian = at("u_projection_clip_antimeridian")
  if (antimeridian) gl.uniform1f(antimeridian, p.clipAntimeridian ? 1 : 0)
}

/**
 * `M x T(origin)`, column-major, composed in DOUBLE and only then rounded. `0200`, see
 * `MaskResources.origin`. Only column 3 changes: `M x (ox, oy, 0, 1)`. At z17 its terms are ~1e7
 * before and a few thousand after, which is the whole fix — the cancellation happens here, in 53
 * bits, instead of on the GPU in 24.
 */
export function translated(m: ArrayLike<number>, origin: readonly [number, number]): Float32Array {
  const out = new Float32Array(16)
  for (let i = 0; i < 16; i++) out[i] = m[i] ?? 0
  for (let r = 0; r < 4; r++) {
    out[12 + r] = (m[r] ?? 0) * origin[0] + (m[4 + r] ?? 0) * origin[1] + (m[12 + r] ?? 0)
  }
  return out
}

/* ─── GL resources ──────────────────────────────────────────────────────────── */

export type MaskResources = {
  maskProgram: WebGLProgram
  debugProgram: WebGLProgram
  quadBuffer: WebGLBuffer
  instanceBuffer: WebGLBuffer
  maskVAO: WebGLVertexArrayObject
  debugVAO: WebGLVertexArrayObject
  fbo: WebGLFramebuffer
  texture: WebGLTexture
  maskW: number
  maskH: number
  /** How many instances the buffer currently holds — `visibleInstanceCount` (criterion 9). */
  instanceCount: number
  /** Capacity in instances, so a same-or-smaller upload can reuse the allocation. */
  capacity: number
  /**
   * THE MERCATOR POINT EVERY UPLOADED CENTRE IS RELATIVE TO. `0200`.
   *
   * Absolute centres put the fog edge on a staircase at high zoom. The projection's translation
   * terms are ~`mercator x worldSize`, and `uniformMatrix4fv` rounds them to `float32`: at z17 the
   * rounding step is ~1.2 CSS px, so on a slow pan every disc sits still and then jumps while the
   * basemap — which MapLibre draws in tile-local coordinates for exactly this reason — slides.
   * Measured on SwiftShader through this shader: 48 of 50 frames of a 0.2 px/frame pan stuck, jumps
   * of 4.5 device px; relative to an origin, 0.2 px worst error. `MASK_SCALE = 1` changed nothing.
   *
   * So `uploadInstances` subtracts this origin once per bucket, and `setProjectionUniforms` adds it
   * back into the matrix IN DOUBLE, where the large terms cancel before anything is rounded.
   */
  origin: [number, number]
  /**
   * Whether the origin can be folded into `u_projection_matrix`. True under the mercator prelude,
   * whose `projectTile(p)` is just `matrix x (p, 0, 1)`. False under `#define GLOBE`, whose prelude
   * does its own thing with `p` — there `u_origin` carries it instead, which is the old precision
   * and correct, and MapLibre only shows the globe at low zoom where the rounding is sub-pixel.
   */
  foldOrigin: boolean
  /**
   * `0079`. `revealProgress`, read by the pass as `u_reveal`. **1 whenever no reveal is running**, and
   * the shader short-circuits on it, so the steady state is the same bytes it always was. Setting it
   * is a uniform write on the next pass — never a buffer upload, never an FBO allocation.
   */
  revealProgress: number
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error("createShader returned null")
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "(no log)"
    gl.deleteShader(shader)
    // The log, verbatim and unabridged. A driver-specific compile failure is a finding, not a
    // detail, and it must reach whoever is looking rather than arrive as "shader failed".
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

/** The unit quad, as a 4-vertex `TRIANGLE_STRIP`. One buffer, shared by every instance. */
const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])

/** Byte offsets of criterion 5's layout within one instance. Named so the VAO cannot invent them. */
const ATTRIBUTES = [
  ["a_center", 2, 0],
  ["a_radius", 1, 8],
  ["a_fraction", 1, 12],
  ["a_arc", 1, 16],
] as const

function buildMaskVAO(
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
  for (const [name, size, offset] of ATTRIBUTES) {
    const loc = gl.getAttribLocation(program, name)
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset)
    // THE DIVISOR IS THE WHOLE TICKET. Without it every instance reads vertex 0's centre and the
    // 6,000-cell draw renders one disc — which looks like "the data is wrong", not like a VAO bug.
    gl.vertexAttribDivisor(loc, 1)
  }

  gl.bindVertexArray(null)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
  return vao
}

/**
 * Allocate (or reallocate) the half-resolution `R8` mask: `LINEAR`, `CLAMP_TO_EDGE` (§4.2).
 *
 * `LINEAR` matters even though nothing in pass 1 samples the mask at a scale other than the one it
 * was written at: §4.2's reason is that the bilinear upsample in `0056`'s composite is a free extra
 * feather, and allocating it `NEAREST` here would hand `0056` a texture whose filtering had never
 * been exercised — and a hard-edged mask under a noise threshold looks like the noise is wrong.
 *
 * `CLAMP_TO_EDGE` because the composite samples at the very edge of the texture; `REPEAT` would
 * wrap coverage from the opposite side of the screen into the border pixels.
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

/** Half the drawing buffer, floored, never zero — a 1px canvas must still produce a valid FBO. */
export function maskDimensions(width: number, height: number): { maskW: number; maskH: number } {
  return {
    maskW: Math.max(1, Math.floor(width * MASK_SCALE)),
    maskH: Math.max(1, Math.floor(height * MASK_SCALE)),
  }
}

export function createMaskResources(
  gl: WebGL2RenderingContext,
  options: { prelude: string; define: string; width: number; height: number },
): MaskResources {
  const maskProgram = link(gl, maskVertexSource(options.prelude, options.define), MASK_FRAGMENT_SOURCE)
  const debugProgram = link(gl, DEBUG_VERTEX_SOURCE, DEBUG_FRAGMENT_SOURCE)

  const quadBuffer = gl.createBuffer()
  const instanceBuffer = gl.createBuffer()
  if (!quadBuffer || !instanceBuffer) throw new Error("createBuffer returned null")

  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)

  const maskVAO = buildMaskVAO(gl, maskProgram, quadBuffer, instanceBuffer)
  const debugVAO = gl.createVertexArray()
  if (!debugVAO) throw new Error("createVertexArray returned null")

  const { maskW, maskH } = maskDimensions(options.width, options.height)
  const { fbo, texture } = allocateMask(gl, null, maskW, maskH)

  return {
    maskProgram,
    debugProgram,
    quadBuffer,
    instanceBuffer,
    maskVAO,
    debugVAO,
    fbo,
    texture,
    maskW,
    maskH,
    instanceCount: 0,
    capacity: 0,
    origin: [0, 0],
    foldOrigin: !options.define.includes("GLOBE"),
    revealProgress: 1,
  }
}

/**
 * Upload one bucket's packed instances. **Once per bucket, never per frame** (criterion 5) — the
 * caller decides when that is; nothing on the frame path calls this.
 *
 * `DYNAMIC_DRAW` because `0058` re-uploads on a padded-region exit or a bucket change, and `0079`'s
 * mid-session delta re-uploads a handful of new cells. Reusing the allocation when the new data
 * fits is what keeps a pan from churning GPU memory; `bufferSubData` into a larger buffer is safe
 * because `instanceCount` — not the buffer's size — is what the draw call reads.
 */
export function uploadInstances(
  gl: WebGL2RenderingContext,
  res: MaskResources,
  instances: Float32Array,
): void {
  const count = Math.floor(instances.length / INSTANCE_FLOATS)
  // `0200`: centres relative to the first one, snapped to `ORIGIN_GRID` (`0079` — see there). A
  // copy, not an in-place edit — the caller keeps its array to re-upload after a context loss, and
  // this runs once per bucket, never per frame.
  const origin: [number, number] =
    count > 0 ? [snapToGrid(instances[0]!), snapToGrid(instances[1]!)] : [0, 0]
  const relative = instances.slice(0, count * INSTANCE_FLOATS)
  for (let i = 0; i < relative.length; i += INSTANCE_FLOATS) {
    relative[i] = instances[i]! - origin[0]
    relative[i + 1] = instances[i + 1]! - origin[1]
  }
  res.origin = origin
  gl.bindBuffer(gl.ARRAY_BUFFER, res.instanceBuffer)
  if (count > res.capacity) {
    gl.bufferData(gl.ARRAY_BUFFER, relative, gl.DYNAMIC_DRAW)
    res.capacity = count
  } else {
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, relative)
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
  res.instanceCount = count
}

function snapToGrid(v: number): number {
  return Math.floor(v / ORIGIN_GRID) * ORIGIN_GRID
}

/** Reallocate the mask after a resize. Returns whether anything changed. */
export function resizeMask(
  gl: WebGL2RenderingContext,
  res: MaskResources,
  width: number,
  height: number,
): boolean {
  const { maskW, maskH } = maskDimensions(width, height)
  if (maskW === res.maskW && maskH === res.maskH) return false
  allocateMask(gl, { fbo: res.fbo, texture: res.texture }, maskW, maskH)
  res.maskW = maskW
  res.maskH = maskH
  return true
}

export function disposeMaskResources(gl: WebGL2RenderingContext, res: MaskResources): void {
  gl.deleteProgram(res.maskProgram)
  gl.deleteProgram(res.debugProgram)
  gl.deleteBuffer(res.quadBuffer)
  gl.deleteBuffer(res.instanceBuffer)
  gl.deleteVertexArray(res.maskVAO)
  gl.deleteVertexArray(res.debugVAO)
  gl.deleteFramebuffer(res.fbo)
  gl.deleteTexture(res.texture)
}

/* ─── The prerender pass ────────────────────────────────────────────────────── */

const BLEND_EQUATION_NAMES: Record<number, string> = {
  0x8006: "FUNC_ADD",
  0x8007: "MIN",
  0x8008: "MAX",
  0x800a: "FUNC_SUBTRACT",
  0x800b: "FUNC_REVERSE_SUBTRACT",
}

/** What `runMaskPass` put back, read from the driver rather than assumed. Criterion 4. */
export type RestoreCheck = {
  blendEquationRGB: string
  blendEquationAlpha: string
  blendSrcRGB: number
  blendDstRGB: number
  framebufferUnbound: boolean
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

/**
 * §4.2's pass, inside MapLibre's `prerender`. **One `drawArraysInstanced`, whatever the cell
 * count** (criterion 3) — one draw call per cell is draw-call bound around ~2k cells and §4 rules
 * it out explicitly.
 *
 * `blendFunc(ONE, ONE)` is set even though GLES3 ignores the blend factors entirely for `MIN` and
 * `MAX`. It is in §4.2, it costs nothing, and a later session changing the equation without noticing
 * the factors were never set is a worse outcome than one redundant call.
 *
 * THE RESTORE IS BELT AND BRACES AND §4.2 SAYS SO. MapLibre calls `setBaseState()` and
 * `bindFramebuffer.set(null)` after both custom-layer hooks, so it would recover on its own.
 * Leaving `MAX` set anyway "is the kind of bug that shows up three layers later as 'why is the
 * basemap wrong'". The read-back exists because criterion 4 asks for proof rather than for trust.
 *
 * `blendOverride` is SELF-TEST ONLY and `tools/fog-harness` is its only caller: a probe that can
 * only report success is a decoration, so the harness forces `FUNC_ADD` and forces blending off to
 * prove its own assertions can fail. Nothing in the app ever passes it.
 */
export function runMaskPass(
  gl: WebGL2RenderingContext,
  res: MaskResources,
  projection: ProjectionLike,
  options: { blendOverride?: "add" | "off" } = {},
): RestoreCheck {
  const saved = Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array)

  gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo)
  gl.viewport(0, 0, res.maskW, res.maskH)
  // Cleared to 0 every prerender (criterion 2). The mask is screen-space and the camera moves;
  // a stale frame's coverage left in it would smear the fog across a pan.
  gl.clearColor(0, 0, 0, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.disable(gl.DEPTH_TEST)

  if (options.blendOverride === "off") {
    gl.disable(gl.BLEND)
  } else {
    gl.enable(gl.BLEND)
    // Union, not sum. Two overlapping discs give max(a, b), so twice-covered ground is not twice
    // as revealed — which is what makes the mask mean "covered" (§4.1, D-020). Proved on a real
    // driver by 0118.
    gl.blendEquation(options.blendOverride === "add" ? gl.FUNC_ADD : gl.MAX)
    gl.blendFunc(gl.ONE, gl.ONE)
  }

  gl.useProgram(res.maskProgram)
  setProjectionUniforms(gl, res.maskProgram, projection, res.origin, res.foldOrigin)
  // `0079`. Every pass, because a program's uniforms persist but a rebuilt program's do not.
  const reveal = gl.getUniformLocation(res.maskProgram, "u_reveal")
  if (reveal) gl.uniform1f(reveal, res.revealProgress)
  gl.bindVertexArray(res.maskVAO)
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, res.instanceCount)
  gl.bindVertexArray(null)

  gl.blendEquation(gl.FUNC_ADD)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(saved[0]!, saved[1]!, saved[2]!, saved[3]!)

  const after = Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array)
  const named = (value: number) => BLEND_EQUATION_NAMES[value] ?? `0x${value.toString(16)}`
  return {
    blendEquationRGB: named(gl.getParameter(gl.BLEND_EQUATION_RGB) as number),
    blendEquationAlpha: named(gl.getParameter(gl.BLEND_EQUATION_ALPHA) as number),
    blendSrcRGB: gl.getParameter(gl.BLEND_SRC_RGB) as number,
    blendDstRGB: gl.getParameter(gl.BLEND_DST_RGB) as number,
    framebufferUnbound: gl.getParameter(gl.FRAMEBUFFER_BINDING) === null,
    viewportRestored: after.join(",") === saved.join(","),
  }
}

/**
 * Criterion 10's greyscale blit, in `render`, into MapLibre's own framebuffer.
 *
 * A DEBUG VIEW, NOT PASS 2. `0056` replaces this entirely with the fBm-perturbed composite; this
 * exists because until then the mask is invisible, and "is the corridor continuous, with no
 * scalloping" is a question that cannot be asked of a texture nobody can see.
 */
export function runDebugBlit(gl: WebGL2RenderingContext, res: MaskResources): void {
  gl.useProgram(res.debugProgram)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, res.texture)
  const sampler = gl.getUniformLocation(res.debugProgram, "u_mask")
  if (sampler) gl.uniform1i(sampler, 0)
  gl.disable(gl.DEPTH_TEST)
  gl.enable(gl.BLEND)
  gl.blendEquation(gl.FUNC_ADD)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  gl.bindVertexArray(res.debugVAO)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  gl.bindVertexArray(null)
}

/* ─── Readback, for the harness ─────────────────────────────────────────────── */

/**
 * `R8` readback with the fallback the spec does not require but some drivers want — carried over
 * from `0118`, where the retry path was the difference between "MAX is broken" and "the readback
 * is". GLES3 guarantees `RGBA`/`UNSIGNED_BYTE` for any normalised fixed-point colour buffer, so
 * that is tried first and is what desktop and SwiftShader take.
 *
 * Used by `tools/fog-harness` and by nothing on the frame path: `readPixels` stalls the pipeline.
 */
export function readMaskRed(
  gl: WebGL2RenderingContext,
  res: MaskResources,
): { red: Uint8Array; path: string } {
  const pixels = res.maskW * res.maskH
  gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo)
  const rgba = new Uint8Array(pixels * 4)
  gl.readPixels(0, 0, res.maskW, res.maskH, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
  let red: Uint8Array
  let path: string
  if (gl.getError() === gl.NO_ERROR) {
    red = new Uint8Array(pixels)
    for (let i = 0; i < pixels; i++) red[i] = rgba[i * 4]!
    path = "RGBA/UNSIGNED_BYTE"
  } else {
    red = new Uint8Array(pixels)
    gl.readPixels(0, 0, res.maskW, res.maskH, gl.RED, gl.UNSIGNED_BYTE, red)
    path = gl.getError() === gl.NO_ERROR ? "RED/UNSIGNED_BYTE" : "readPixels rejected"
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return { red, path }
}
