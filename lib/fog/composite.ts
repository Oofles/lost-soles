/**
 * PASS 2 — THE NOISY COMPOSITE. Ticket `0056`. `05-fog-of-war.md` §4.3, §4.5.
 *
 * MapLibre calls `render` during its translucent pass. We draw **one full-screen triangle** into
 * MapLibre's own framebuffer, sample `0055`'s half-resolution `R8` coverage mask, and threshold it
 * with a `smoothstep` whose cut point is perturbed by animated 3-octave value-noise fBm — plus a
 * warm, thinned band of "lit mist" on the fog side of the frontier (`0210`).
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
  COLD_DAYS_PER_MONTH,
  COLD_DESATURATE,
  COLD_RAMP_START_MONTHS,
  COLD_RAMP_TAU_MONTHS,
  COLD_WASH_MAX,
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
  WARP_FREQ_MAX,
  WARP_GAIN_R,
  WARP_JITTER_X,
  WARP_JITTER_Y,
  RIM_BAND_R,
  RIM_GAIN,
  RIM_RINGS,
  RIM_TAPS_PER_RING,
  RIM_THIN,
  WARP_WAVELENGTH_R,
  type FogPalette,
  type Rgb,
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
 * `0210`. The rim's ring-blur taps, as ground offsets in units of the band's reach: `RIM_RINGS`
 * rings at k/RIM_RINGS of the reach, `RIM_TAPS_PER_RING` taps each, every ring rotated half a step
 * from the last so no two rings line up. The inner ring weighs most (weight `RIM_RINGS + 1 - k`),
 * so the light falls off away from the frontier. Unrolled into the shader as constants.
 */
export function rimTaps(): { x: number; y: number; w: number }[] {
  const taps: { x: number; y: number; w: number }[] = []
  for (let k = 1; k <= RIM_RINGS; k++) {
    const r = k / RIM_RINGS
    for (let i = 0; i < RIM_TAPS_PER_RING; i++) {
      const a = ((i + 0.5 * k) * 2 * Math.PI) / RIM_TAPS_PER_RING
      taps.push({ x: r * Math.cos(a), y: r * Math.sin(a), w: RIM_RINGS + 1 - k })
    }
  }
  return taps
}

/**
 * The value-noise fBm both full-screen passes share — the composite's wisps and edge warp, and
 * `0100`'s cold pass, which must read the mask at the SAME warped point the composite does. One
 * string, so the two cannot drift. Needs `FBM_OCTAVES` defined.
 */
function noiseFunctionsGlsl(): string {
  return `// A bit-mix over the EXACT integer lattice cell. See divergence 2 in this function's doc comment.
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

`
}

/**
 * `0211`, D-372: the frozen, ground-anchored edge warp — declares `J`, `groundToPx`, `pxUv` and
 * `maskUv` in the caller's `main`, from `q` and `v_uv`. Shared with `0100`'s cold pass so its clip
 * rule reads the coverage of the edge that is actually DRAWN, not of the unwarped disc union.
 */
function edgeWarpGlsl(): string {
  return `    mat2 J = mat2(dFdx(q), dFdy(q));
    mat2 groundToPx = abs(determinant(J)) > 0.0 ? inverse(J) : mat2(0.0);
    vec2 pxUv = vec2(dFdx(v_uv).x, dFdy(v_uv).y);
    vec2 maskUv = v_uv;
    if (u_warp.x > 0.0) {
        vec2 qw = q * u_warp.y;
        vec2 w = vec2(fbm(qw, u_warpOrigin + vec2(${WARP_JITTER_X[0]}.0, ${WARP_JITTER_X[1]}.0)),
                      fbm(qw, u_warpOrigin + vec2(${WARP_JITTER_Y[0]}.0, ${WARP_JITTER_Y[1]}.0))) - 0.5;
        maskUv += (groundToPx * (w * u_warp.x)) * pxUv;
    }
`
}

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
 *  4. **The mask is sampled at a warped point** (`0211`, D-372). This is now §4.3's own text:
 *     the edge warp in `fog-uniforms.ts` and `edgeWarp` below. Without a warp (`u_warp.x == 0`) the
 *     shader reads `v_uv`, the same as the sketch.
 *  5. **The rim is lit mist, not a glow scaled by the edge's own alpha** (`0210`). This is now
 *     §4.3's own text: a ring blur of the mask, on the ground, warms and thins the fog near revealed
 *     ground, and is zero on revealed ground. `rimBand` below sizes it.
 *
 * Everything else — the two drifting fields, the mix, the reveal ramp, the premultiplied output —
 * is §4.3 unchanged.
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
uniform vec3  u_bloomGold;     // 0080: --gold-300, linear 0..1. Read only where the mask's GREEN is lit.
uniform vec3  u_bloomFrost;    // 0080: --frost-400. Read only where the mask's BLUE is lit.
uniform vec3  u_bloomGlint;    // 0080: --route-core, the warm near-white gold leans to at its peak.
uniform vec2  u_warp;          // 0211: (amplitude in noise cells, integer frequency). x = 0 is no warp.
uniform vec2  u_warpOrigin;    // 0211: the warp lattice's integer origin, (origin x freq) mod modulus
uniform float u_rimBand;       // 0210: the lit band's reach on the ground, in noise cells. 0 = no rim.

in  vec2 v_uv;
in  vec3 v_noiseH;
out vec4 fragColor;

${noiseFunctionsGlsl()}void main() {
    // The projective divide. Ground coordinates in noise cells, local to this frame's origin.
    vec2 q = v_noiseH.xy / v_noiseH.z;

    // 0211, D-372. THE EDGE WARP: read the mask at a ground-anchored, noise-displaced point, so the
    // boundary itself moves and the chain of disc outlines breaks up. FROZEN: no u_time term, so only
    // the wisps below animate. The offset is in noise cells, so the inverse of q's screen Jacobian
    // turns it into pixels, which is correct under pitch as well. All of RGB is read at the moved
    // point, so 0080's bloom follows the same edge as the coverage.
    //
    // Ground -> screen: q's screen Jacobian is noise cells per pixel, so its inverse times a ground
    // offset in noise cells is pixels, and \`pxUv\` turns pixels into mask UV. Shared by the warp and
    // by 0210's rim taps. A degenerate frame gets a zero matrix: no warp and no rim, never a NaN.
${edgeWarpGlsl()}
    vec3  mask = texture(u_mask, maskUv).rgb;
    float coverage = mask.r;

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

    // 0210. THE RIM IS LIT MIST: fog within u_rimBand of revealed ground is warmed toward
    // u_rimGlow and thinned, as if lantern light from the cleared side were falling on it. How near
    // revealed ground is: a ring blur of the reveal ramp over the mask, the taps placed ON THE GROUND
    // (groundToPx), so the band is a fixed fraction of a disc at every zoom, pitch and bearing.
    // The (1 - reveal) factor is the D-051 guarantee: fully revealed ground gets lit = 0 exactly, so
    // the rim never tints, thins or veils cleared ground. There is no alpha floor any more either:
    // the old rim floored alpha at rim * 0.10, a veil laid over cleared ground.
    float lit = 0.0;
    if (u_rimBand > 0.0 && u_rimAmt > 0.0 && reveal < 1.0) {
        float near = 0.0;
        // The tap pattern is unrolled at build time (\`rimTaps\`): each tap is a constant ground offset in
        // units of u_rimBand, with its ring's weight. No sin/cos per fragment.
        mat2 tapToUv = mat2(groundToPx[0] * pxUv, groundToPx[1] * pxUv) * u_rimBand;
${rimTaps()
  .map(
    (t) =>
      `        near += ${t.w.toFixed(1)} * smoothstep(${REVEAL_LO}, ${REVEAL_HI}, texture(u_mask, maskUv + tapToUv * vec2(${t.x.toFixed(6)}, ${t.y.toFixed(6)})).r);`,
  )
  .join("\n")}
        lit = clamp(near * ${(RIM_GAIN / rimTaps().reduce((sum, t) => sum + t.w, 0)).toFixed(6)}, 0.0, 1.0) * (1.0 - reveal) * u_rimAmt;
    }
    col = mix(col, u_rimGlow, lit);
    alpha *= 1.0 - lit * ${RIM_THIN.toFixed(4)};

    vec4 outColor = vec4(col * alpha, alpha);   // premultiplied — MapLibre's default blend

    // 0080. BEAT 1'S BLOOM, laid OVER the fog, premultiplied. GREEN and BLUE are 0 outside a reveal,
    // so both alphas are 0 and outColor passes through bit for bit: x * 1.0 + 0.0 is exact.
    // Gold leans white at its peak (06 §3.2: "gold-white bloom"); frost is the dimmer of the two.
    float ga = mask.g * ${BLOOM_GOLD_PEAK.toFixed(2)};
    vec3  gc = mix(u_bloomGold, u_bloomGlint, mask.g * ${BLOOM_GOLD_WHITE.toFixed(2)});
    outColor = vec4(gc * ga, ga) + outColor * (1.0 - ga);
    float fa = mask.b * ${BLOOM_FROST_PEAK.toFixed(2)};
    outColor = vec4(u_bloomFrost * fa, fa) + outColor * (1.0 - fa);

    fragColor = outColor;
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
  /** The mercator point at the screen centre. `0211`: the latitude the edge warp sizes discs at. */
  centre: [number, number]
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
 * `composite.test.ts` sweeps a pan across hundreds of origin boundaries and asserts exactly that.
 *
 * A ZOOM now barely exercises this at all, and that is `0199`'s doing rather than an oversight:
 * since D-243 `scale` is quantised to powers of two, so a pure zoom over five levels changes the
 * origin about five times instead of continuously. The pan sweep is what keeps the cancellation
 * honest; the zoom sweep asserts the quantisation instead.
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
/**
 * SNAP THE LATTICE FREQUENCY TO A POWER OF TWO. `0199`, D-243.
 *
 * ─── WHY A CONTINUOUS FREQUENCY IS STATIC, NOT MIST ─────────────────────────
 *
 * The absolute lattice index of a ground point is `floor(scale x mercatorPos)`. `mercatorPos` is
 * ~0.27 and `scale` is ~65,000 at z15, so that index is ~17,600 — and `scale` tracked the zoom
 * continuously, so **one frame of a pinch moved it by hundreds to thousands of cells**. `hashCell`
 * is an integer bit-mix chosen by D-233 precisely so adjacent indices do NOT correlate, so a jump
 * of hundreds is a completely fresh field. Sixty of those a second is what the operator saw and
 * described as *"static on a screen"*.
 *
 * D-233 anchored the noise's TRANSLATION and proved it; it said nothing about its FREQUENCY, and
 * `groundNoiseCoord` cannot catch this because it is `mercX x frame.scale` — stable across a pan by
 * construction, and silent about two frames at different zooms.
 *
 * ─── WHAT THIS BUYS AND WHAT IT COSTS ───────────────────────────────────────
 *
 * `mercPerPixel` halves per zoom level, so the raw scale doubles per level and `log2` of it is the
 * zoom plus a constant. Rounding that makes the lattice **exactly constant within a whole zoom
 * level** — zero drift, which is 94% of a z17-z10 pinch — and step once per level, where the field
 * does re-randomise. Sixty discontinuities a second become seven across the whole pinch.
 *
 * The price is that a cell is no longer exactly `NOISE_PX` on screen: it ranges over
 * `NOISE_PX_MIN`..`NOISE_PX_MAX` (184-368 px) and returns to 256 (`NOISE_PX_QUANTISED`) at each
 * whole level. That is a
 * 2x swing in apparent coarseness across a level, judged the weaker artefact of the two.
 *
 * **The exit, if the step is ever judged too visible**, is not to interpolate `scale` — that makes
 * the field depend on camera history and only hides the symptom on a slow zoom. It is to weight the
 * fBm octaves by `frac(log2(rawScale))` so the field is continuous ACROSS the boundary at the same
 * octave count: near-free on the GPU, but it changes the octave structure that `0119`'s deferred
 * tuning findings were recorded against. `0199` considered it and deliberately did the cheap thing
 * first.
 */
export function quantiseNoiseScale(rawScale: number): number {
  return Math.pow(2, Math.round(Math.log2(rawScale)))
}

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
      centre: [NaN, NaN],
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

  const scale = quantiseNoiseScale(1 / (mercPerPixel * NOISE_PX))
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
    centre: [cx, cy],
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

/* ─── The edge warp (0211, D-372) ─────────────────────────────────────────── */

/** One frame's edge warp, as `u_warp` and `u_warpOrigin` carry it. */
export interface EdgeWarp {
  /** How far the warp may move the sample point, in NOISE cells per unit of `fbm - 0.5`. 0 = off. */
  amp: number
  /** The integer multiplier from D-233's lattice to the warp's lattice. A power of two. */
  freq: number
  /** `(frame.origin x freq) mod NOISE_ORIGIN_MODULUS`, reduced here in double precision. */
  origin: [number, number]
}

/** No warp: the composite reads the mask at `v_uv`, exactly as before `0211`. Harnesses use it. */
export const NO_EDGE_WARP: EdgeWarp = { amp: 0, freq: 1, origin: [0, 0] }

/** The latitude, in degrees, of a mercator y in MapLibre's 0..1 convention (0 = north). */
export function latOfMercY(y: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI
}

/**
 * SIZE THE EDGE WARP FROM THE DISC, NOT FROM THE SCREEN. `0211`, D-372.
 *
 * `equatorRadiusMerc` is the current bucket's disc radius, `discRadiusM(res)`, converted to mercator
 * AT THE EQUATOR. The amplitude divides it by `cos(latitude)` at the screen centre, so the warp is a
 * fixed fraction of a disc on the ground, at every zoom and in every bucket. A warp sized in screen
 * pixels was rendered and rejected: at z14 it bent a corridor about 75 m off its true shape.
 *
 * THE FREQUENCY DELIBERATELY IGNORES LATITUDE. It is chosen from the equatorial radius, so it
 * depends on `scale` and the bucket resolution and nothing else. If it followed the camera's
 * latitude, a north-south pan near a rounding boundary would flip it, and the whole edge would
 * re-randomise in mid-pan. With the default constants that boundary sits around 52°N. The price is
 * that the warp's wavelength, measured in disc radii, shrinks by `cos(latitude)`: about 1.5 at the
 * operator's 30°N and 1.1 at 50°N. Both are inside the √2 that power-of-two rounding already allows.
 *
 * WHY THE FREQUENCY IS A POWER OF TWO. The warp lattice index of a ground point is
 * `merc x scale x freq`. `scale` is a power of two already (D-243), so making `freq` one as well
 * keeps `scale x freq` exactly constant when `scale` doubles and `freq` halves. That happens at every
 * zoom-level step inside one bucket resolution. So from z14 to z18 the warp field is the SAME field
 * at every zoom: D-243's per-level step happens in the wisps and not in the edge. The amplitude is
 * `WARP_GAIN_R x radius` in ground terms, and that is constant over the same range. Both change
 * only where the bucket's resolution changes, which already redraws the whole mask.
 *
 * Off (`NO_EDGE_WARP`) on a degenerate frame. There is no ground to anchor to, and a screen-space
 * warp would crawl.
 */
export function edgeWarp(frame: NoiseFrame, equatorRadiusMerc: number): EdgeWarp {
  if (frame.degenerate || !(frame.scale > 0) || !(equatorRadiusMerc > 0)) return NO_EDGE_WARP
  const cosLat = Math.cos((latOfMercY(frame.centre[1]) * Math.PI) / 180)
  if (!(cosLat > 0)) return NO_EDGE_WARP
  const ideal = 1 / (frame.scale * WARP_WAVELENGTH_R * equatorRadiusMerc)
  const freq = Math.min(WARP_FREQ_MAX, Math.max(1, 2 ** Math.round(Math.log2(ideal))))
  const wrap = (v: number) => ((v % NOISE_ORIGIN_MODULUS) + NOISE_ORIGIN_MODULUS) % NOISE_ORIGIN_MODULUS
  return {
    amp: (WARP_GAIN_R * equatorRadiusMerc * frame.scale) / cosLat,
    freq,
    origin: [wrap(frame.origin[0] * freq), wrap(frame.origin[1] * freq)],
  }
}

/**
 * `0210`. THE RIM'S REACH, SIZED FROM THE DISC, as `edgeWarp` sizes the warp and for the same reason
 * (D-372): `RIM_BAND_R` disc radii on the ground, in noise cells, so the lit band is the same fraction
 * of a corridor at every zoom. Sized in screen pixels it would swamp a z14 corridor (a res-11 disc is
 * ~9 px there) and thin to a hairline at z18. It also keeps the ring blur's tap spacing a constant
 * fraction of a disc, so the sampling quality does not change with zoom either.
 *
 * 0 (no rim) on a degenerate frame, as `edgeWarp` returns `NO_EDGE_WARP` there.
 */
export function rimBand(frame: NoiseFrame, equatorRadiusMerc: number): number {
  if (frame.degenerate || !(frame.scale > 0) || !(equatorRadiusMerc > 0)) return 0
  const cosLat = Math.cos((latOfMercY(frame.centre[1]) * Math.PI) / 180)
  if (!(cosLat > 0)) return 0
  return (RIM_BAND_R * equatorRadiusMerc * frame.scale) / cosLat
}

/**
 * The absolute warp-lattice coordinate of one mercator point. TEST-ONLY, `groundNoiseCoord`'s
 * counterpart: two frames related by a pan, or by a pinch inside one bucket, must agree on it.
 */
export function groundWarpCoord(
  frame: NoiseFrame,
  warp: EdgeWarp,
  mercX: number,
  mercY: number,
): [number, number] {
  return [mercX * frame.scale * warp.freq, mercY * frame.scale * warp.freq]
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
  "u_bloomGold",
  "u_bloomFrost",
  "u_bloomGlint",
  "u_warp",
  "u_warpOrigin",
  "u_rimBand",
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
  /** `0080`. The bloom's two colours. Irrelevant outside a reveal — the mask carries no bloom then. */
  bloom: BloomPalette
  /** `0211`. The edge warp, from `edgeWarp`. Omitted means `NO_EDGE_WARP`, which the GPU harnesses rely on. */
  warp?: EdgeWarp
  /** `0210`. The rim's reach in noise cells, from `rimBand`. Omitted or 0 means no rim. */
  rimBand?: number
}

/**
 * `0080`. BEAT 1'S GROUND COLOURS, from `app/tokens.css` (`--gold-300`, `--frost-400`, and
 * `--route-core` as the glint gold leans to — §8.2 forbids pure white, and the route's cream is the
 * lantern's own near-white), resolved
 * by the caller — a paint value in a shader cannot be a CSS variable, and a literal here would be a
 * second copy of a palette colour (`lib/map-layers.ts` makes the same argument for the route).
 */
export interface BloomPalette {
  gold: Rgb
  frost: Rgb
  glint: Rgb
}

/** Black, and never visible: it is only ever multiplied by a bloom of 0. */
export const NO_BLOOM_PALETTE: BloomPalette = { gold: [0, 0, 0], frost: [0, 0, 0], glint: [0, 0, 0] }

/**
 * `0080`. How much of the ground a full bloom tints. A look, tuned by eye on the run page: gold is
 * *"the loud one"*, frost *"dimmer and slower"* (06 §3.2). The white mix is what makes gold read as
 * gold-WHITE light rather than paint at its peak, and it falls away with the bloom.
 */
export const BLOOM_GOLD_PEAK = 0.55
export const BLOOM_GOLD_WHITE = 0.4
export const BLOOM_FROST_PEAK = 0.32

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
  const b = frame.bloom
  if (u.u_bloomGold) gl.uniform3f(u.u_bloomGold, b.gold[0], b.gold[1], b.gold[2])
  if (u.u_bloomFrost) gl.uniform3f(u.u_bloomFrost, b.frost[0], b.frost[1], b.frost[2])
  if (u.u_bloomGlint) gl.uniform3f(u.u_bloomGlint, b.glint[0], b.glint[1], b.glint[2])
  const w = frame.warp ?? NO_EDGE_WARP
  if (u.u_warp) gl.uniform2f(u.u_warp, w.amp, w.freq)
  if (u.u_warpOrigin) gl.uniform2f(u.u_warpOrigin, w.origin[0], w.origin[1])
  if (u.u_rimBand) gl.uniform1f(u.u_rimBand, frame.rimBand ?? 0)

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

/* ─── Cold territory: pass 3, atlas only (ticket 0100) ──────────────────────── */

/**
 * D65 white and the sRGB → XYZ matrix, for the CIELAB round trip the saturation shift needs. D-371
 * measures basemap saturation in CIELAB, so the shift is made there: L* is kept, a* and b* scale.
 */
const D65: Rgb = [0.95047, 1.0, 1.08883]

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

/** sRGB 0..1 → CIELAB (L* 0..100). The shader's `toLab`, for the tests. */
export function srgbToLab(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map(srgbToLinear) as [number, number, number]
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / D65[0]
  const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) / D65[1]
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / D65[2]
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  const fx = f(x)
  const fy = f(y)
  const fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** CIELAB → sRGB 0..1, clamped. The shader's `fromLab`. */
export function labToSrgb(lab: readonly [number, number, number]): [number, number, number] {
  const fy = (lab[0] + 16) / 116
  const fx = fy + lab[1] / 500
  const fz = fy - lab[2] / 200
  const inv = (t: number) => (t * t * t > 216 / 24389 ? t * t * t : (116 * t - 16) / (24389 / 27))
  const x = inv(fx) * D65[0]
  const y = inv(fy) * D65[1]
  const z = inv(fz) * D65[2]
  const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z
  const g = -0.969266 * x + 1.8760108 * y + 0.041556 * z
  const b = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z
  const c = (v: number) => Math.min(1, Math.max(0, linearToSrgb(Math.min(1, Math.max(0, v)))))
  return [c(r), c(g), c(b)]
}

/** D-371's saturation, C* ÷ √(C*² + L*²), of an sRGB colour. */
export function labSaturation(rgb: Rgb): number {
  const [l, a, b] = srgbToLab(rgb)
  const c = Math.hypot(a, b)
  return c === 0 ? 0 : c / Math.hypot(c, l)
}

/**
 * ONE PIXEL OF COLD GROUND, in JavaScript — the cold pass's arithmetic for the tests and the harness.
 * `amount` is the wash's strength 0..1 (normalised ramp × clip × mode weight). The saturation shift
 * (a*, b* scaled by `1 − COLD_DESATURATE × amount`) and THEN the multiply by `mix(1, wash, opacity)`
 * with `opacity = COLD_WASH_MAX × amount`. At amount 0 it is the ground unchanged — but the pass
 * never even draws there; it discards.
 */
export function coldPixel(ground: Rgb, wash: Rgb, amount: number): [number, number, number] {
  const [l, a, b] = srgbToLab(ground)
  const keep = 1 - COLD_DESATURATE * amount
  const shifted = labToSrgb([l, a * keep, b * keep])
  const op = COLD_WASH_MAX * amount
  return [
    shifted[0] * (1 - op + wash[0] * op),
    shifted[1] * (1 - op + wash[1] * op),
    shifted[2] * (1 - op + wash[2] * op),
  ]
}

/** The centre tap's weight in the cold feather, against `rimTaps`' ring weights (2 inner, 1 outer). */
export const COLD_CENTRE_WEIGHT = 3

/**
 * PASS 3 — COLD GROUND. `06-ui-ux.md` §4.6, D-133, D-147. Atlas only: the layer does not run it at
 * all while `coldWash` is 0, so adventure is the same frame it always was.
 *
 * ─── WHY A PASS OF ITS OWN, AND WHY IT READS A COPY OF THE FRAME ────────────
 *
 * The composite blends `ONE, ONE_MINUS_SRC_ALPHA` over MapLibre's frame, and with that a shader can
 * lay a colour OVER the ground but cannot see it. §4.6's wash is a MULTIPLY plus a SATURATION shift,
 * and a saturation shift mixes the ground's own channels, which no blend equation can express. So
 * the layer copies the frame under the fog into `u_ground` (one `copyTexSubImage2D`, only on frames
 * where atlas has cold ground in the buffer) and this pass writes the finished colour, opaque,
 * discarding every pixel it does not change. The composite then draws over it exactly as before.
 *
 * ─── THE CLIP AND THE FEATHER ───────────────────────────────────────────────
 *
 * `coverage` is RED at the WARPED point (D-372) — the edge the composite actually draws — and the
 * clip `smoothstep(0.0, 0.25, coverage − 0.75)` is exactly 0 at or below 0.75, so cold ground can
 * never reach the frontier (D-147). The feather is a ring blur of the cold field in SCREEN space
 * (§4.6's "40 px"), `rimTaps`' pattern at `u_featherUv`, each tap weighted by its own coverage: ground
 * with no disc on it has no warmth to report and must not read as cold.
 *
 * The cold field is ALPHA: warmth `1 − age / u_ageSpan` (`mask.ts`), turned back into an age here and
 * through §4.6's ramp — `coldWashOpacity`, normalised.
 */
export function coldFragmentSource(octaves: number = FBM_OCTAVES): string {
  const taps = rimTaps()
  const lines = taps
    .map(
      (t) =>
        `    { vec4 s = texture(u_mask, maskUv + u_featherUv * vec2(${t.x.toFixed(6)}, ${t.y.toFixed(6)})); ` +
        `float w = ${t.w.toFixed(1)} * s.r; wsum += w; ksum += w * coldness(s.a); }`,
    )
    .join("\n")
  return `#version 300 es
precision highp float;

#define FBM_OCTAVES ${Math.max(1, Math.floor(octaves))}

uniform sampler2D u_mask;
uniform sampler2D u_ground;    // 0100: a copy of the frame under the fog layer
uniform vec2  u_warp;          // 0211: the composite's edge warp, so the clip reads the DRAWN edge
uniform vec2  u_warpOrigin;
uniform float u_coldWash;      // 0100: the mode's weight, 0..1 — rides the 320 ms fade
uniform vec2  u_featherUv;     // 0100: the feather's reach, in uv
uniform vec3  u_washColor;     // 0100: --cold-wash
uniform float u_ageSpan;       // 0100: mask.ts COLD_AGE_SPAN_DAYS

in  vec2 v_uv;
in  vec3 v_noiseH;
out vec4 fragColor;

${noiseFunctionsGlsl()}
// 0100. coldWashOpacity / COLD_WASH_MAX, from the mask's warmth. 0 up to month ${COLD_RAMP_START_MONTHS}.
float coldness(float warmth) {
    float m = (1.0 - warmth) * u_ageSpan / ${COLD_DAYS_PER_MONTH.toFixed(6)} - ${COLD_RAMP_START_MONTHS.toFixed(1)};
    if (m <= 0.0) return 0.0;
    float x = m / ${COLD_RAMP_TAU_MONTHS.toFixed(6)};
    return 1.0 - exp(-x * x);
}

vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
vec3 labF(vec3 t) { return mix((t * ${(24389 / 27).toFixed(6)} + 16.0) / 116.0, pow(t, vec3(1.0 / 3.0)), step(vec3(${(216 / 24389).toFixed(8)}), t)); }
vec3 labFInv(vec3 t) { vec3 t3 = t * t * t; return mix((116.0 * t - 16.0) / ${(24389 / 27).toFixed(6)}, t3, step(vec3(${(216 / 24389).toFixed(8)}), t3)); }

vec3 toLab(vec3 srgb) {
    vec3 l = toLinear(srgb);
    vec3 xyz = vec3(dot(l, vec3(0.4124564, 0.3575761, 0.1804375)),
                    dot(l, vec3(0.2126729, 0.7151522, 0.0721750)),
                    dot(l, vec3(0.0193339, 0.1191920, 0.9503041))) / vec3(${D65.join(", ")});
    vec3 f = labF(xyz);
    return vec3(116.0 * f.y - 16.0, 500.0 * (f.x - f.y), 200.0 * (f.y - f.z));
}

vec3 fromLab(vec3 lab) {
    float fy = (lab.x + 16.0) / 116.0;
    vec3 xyz = labFInv(vec3(fy + lab.y / 500.0, fy, fy - lab.z / 200.0)) * vec3(${D65.join(", ")});
    vec3 l = vec3(dot(xyz, vec3(3.2404542, -1.5371385, -0.4985314)),
                  dot(xyz, vec3(-0.9692660, 1.8760108, 0.0415560)),
                  dot(xyz, vec3(0.0556434, -0.2040259, 1.0572252)));
    return clamp(toSrgb(clamp(l, 0.0, 1.0)), 0.0, 1.0);
}

void main() {
    vec2 q = v_noiseH.xy / v_noiseH.z;
${edgeWarpGlsl()}
    vec4 m = texture(u_mask, maskUv);
    // THE CLIP RULE (06 §4.6). Exactly 0 at coverage <= 0.75: no cold pixel within two cell-widths
    // of the frontier, ever.
    float coverage = m.r;
    float clip = smoothstep(0.0, 0.25, coverage - 0.75);
    if (clip <= 0.0 || u_coldWash <= 0.0) discard;

    // THE FEATHER: a coverage-weighted ring blur of coldness, in screen space.
    float wsum = ${COLD_CENTRE_WEIGHT.toFixed(1)} * m.r;
    float ksum = wsum * coldness(m.a);
${lines}
    float amount = (ksum / wsum) * clip * u_coldWash;
    if (amount <= 0.0) discard;

    vec3 ground = texture(u_ground, v_uv).rgb;
    vec3 lab = toLab(ground);
    lab.yz *= 1.0 - ${COLD_DESATURATE.toFixed(4)} * amount;
    float op = ${COLD_WASH_MAX.toFixed(4)} * amount;
    fragColor = vec4(fromLab(lab) * mix(vec3(1.0), u_washColor, op), 1.0);
}`
}

export interface ColdResources {
  program: WebGLProgram
  vao: WebGLVertexArrayObject
  uniforms: Record<string, WebGLUniformLocation | null>
  /** The copy of the frame under the fog. `RGB8`, sized to the drawing buffer on demand. */
  ground: WebGLTexture
  groundW: number
  groundH: number
}

const COLD_UNIFORMS = [
  "u_mask",
  "u_ground",
  "u_noiseMatrix",
  "u_warp",
  "u_warpOrigin",
  "u_coldWash",
  "u_featherUv",
  "u_washColor",
  "u_ageSpan",
] as const

export function createColdResources(gl: WebGL2RenderingContext, options: { octaves?: number } = {}): ColdResources {
  const vs = compile(gl, gl.VERTEX_SHADER, COMPOSITE_VERTEX_SOURCE)
  const fs = compile(gl, gl.FRAGMENT_SHADER, coldFragmentSource(options.octaves ?? FBM_OCTAVES))
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
    throw new Error(`cold program link: ${info}`)
  }
  const vao = gl.createVertexArray()
  const ground = gl.createTexture()
  if (!vao || !ground) throw new Error("createVertexArray/createTexture returned null")
  const uniforms: Record<string, WebGLUniformLocation | null> = {}
  for (const name of COLD_UNIFORMS) uniforms[name] = gl.getUniformLocation(program, name)
  return { program, vao, uniforms, ground, groundW: 0, groundH: 0 }
}

export function disposeColdResources(gl: WebGL2RenderingContext, res: ColdResources): void {
  gl.deleteProgram(res.program)
  gl.deleteVertexArray(res.vao)
  gl.deleteTexture(res.ground)
}

export interface ColdFrame {
  mask: WebGLTexture
  noise: NoiseFrame
  warp?: EdgeWarp
  /** The mode's weight, 0..1 (`FogPalette.coldWash`). The layer skips the pass at 0. */
  coldWash: number
  /** The feather's reach in DRAWING-BUFFER pixels: half of `COLD_FEATHER_PX`, times the pixel ratio. */
  featherPx: number
  wash: Rgb
  /** `mask.ts`'s `COLD_AGE_SPAN_DAYS`, passed in so this module keeps its one import. */
  ageSpan: number
}

/**
 * Copy the frame under the fog and draw cold ground over it. Leaves MapLibre's translucent-pass blend
 * state (`ONE, ONE_MINUS_SRC_ALPHA`) and texture unit 0 active, as the composite after it expects.
 */
export function runColdPass(gl: WebGL2RenderingContext, res: ColdResources, frame: ColdFrame): void {
  const w = gl.drawingBufferWidth
  const h = gl.drawingBufferHeight

  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, res.ground)
  if (res.groundW !== w || res.groundH !== h) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, w, h, 0, gl.RGB, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    res.groundW = w
    res.groundH = h
  }
  // The frame as MapLibre has drawn it so far: the basemap below the fog's slot, nothing above it.
  gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h)

  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, frame.mask)

  const u = res.uniforms
  gl.useProgram(res.program)
  if (u.u_mask) gl.uniform1i(u.u_mask, 0)
  if (u.u_ground) gl.uniform1i(u.u_ground, 1)
  if (u.u_noiseMatrix) gl.uniformMatrix3fv(u.u_noiseMatrix, false, frame.noise.matrix)
  const warp = frame.warp ?? NO_EDGE_WARP
  if (u.u_warp) gl.uniform2f(u.u_warp, warp.amp, warp.freq)
  if (u.u_warpOrigin) gl.uniform2f(u.u_warpOrigin, warp.origin[0], warp.origin[1])
  if (u.u_coldWash) gl.uniform1f(u.u_coldWash, frame.coldWash)
  if (u.u_featherUv) gl.uniform2f(u.u_featherUv, frame.featherPx / w, frame.featherPx / h)
  if (u.u_washColor) gl.uniform3f(u.u_washColor, frame.wash[0], frame.wash[1], frame.wash[2])
  if (u.u_ageSpan) gl.uniform1f(u.u_ageSpan, frame.ageSpan)

  gl.disable(gl.DEPTH_TEST)
  // Opaque: the pass writes the finished ground colour, or discards.
  gl.disable(gl.BLEND)
  gl.bindVertexArray(res.vao)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  gl.bindVertexArray(null)

  gl.enable(gl.BLEND)
  gl.blendEquation(gl.FUNC_ADD)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, null)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, null)
}
