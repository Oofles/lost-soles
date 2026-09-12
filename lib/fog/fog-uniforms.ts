/**
 * EVERY TUNABLE NUMBER IN PASS 2, IN ONE MODULE. Ticket `0056` criterion 5.
 * `05-fog-of-war.md` §4.3, §4.5, §5.2.
 *
 * ─── WHY A SEPARATE MODULE FROM THE SHADER ──────────────────────────────────
 *
 * `0119` is the taste pass and it is time-boxed. A time-boxed tuning session that has to read a
 * 500-line GL module to find out which numbers it is allowed to move is not time-boxed. Everything
 * here is a number `0119` may change; nothing here is a number that changes behaviour if changed.
 *
 * Capability `15` adds the second map mode. §5.2 is explicit that the two modes differ in
 * *"style-layer configuration and shader uniforms only — no second tileset, no second code path"*,
 * so `ATLAS` and `ADVENTURE` are recorded here, in full, today. **Nothing reads them yet** and
 * nothing here builds a mode switcher — the ticket forbids it. They are written down because a pair
 * that exists only in a table in a design document is a pair that gets re-derived wrongly.
 *
 * ─── WHAT ACTUALLY SHIPS IS `V1`, AND IT IS A HYBRID ────────────────────────
 *
 * `0056` says *"ship atlas-leaning values"* and then lists `u_maxOpacity 0.94` and adventure's
 * colours. That is not a contradiction being papered over, it is the milestone's single rendering:
 * adventure's **look** (near-black-blue fog at 0.94, warm rim) with atlas's **restraint**
 * (`noiseAmp` 0.10, `rimAmt` 0.08, so the edge stays close to true coverage and the glow is a
 * hairline). §2.3 carries one rendering, not two, and D-051 binds it.
 *
 * The one number where `V1` and §5.2's atlas column genuinely disagree is `maxOpacity`: 0.94 here,
 * 0.55 there. §4.3 defends 0.94 at length and `0056` restates the defence in its own body, so 0.94
 * is what ships. **Atlas's 0.55 is not lost** — it is `ATLAS.maxOpacity` below, waiting for the
 * mode switch that makes a second value meaningful.
 */

/** An RGB triple in linear-ish 0..1 shader space, as the shader's `vec3` uniforms take it. */
export type Rgb = readonly [number, number, number]

/** The six per-mode uniforms of §4.3. `u_mask`, `u_screen` and `u_time` are per-frame, not tunable. */
export interface FogPalette {
  /** `u_fogDeep` — the colour of ground nothing has revealed. */
  readonly fogDeep: Rgb
  /** `u_fogEdge` — lit mist, mixed toward as the noise field brightens. */
  readonly fogEdge: Rgb
  /** `u_rimGlow` — warm parchment at the frontier. §5.1: it picks up the basemap's own hue. */
  readonly rimGlow: Rgb
  /**
   * `u_maxOpacity` — **never 1.0.** §4.3: letting 5-8% of the basemap bleed through is the whole
   * difference between *mist over a map* and *a hole cut in a black sheet*, and it is a direct
   * contribution to D-051 because even fully fogged ground keeps a ghost of its street grid.
   */
  readonly maxOpacity: number
  /** `u_noiseAmp` — how far the fBm field is allowed to displace the reveal threshold. */
  readonly noiseAmp: number
  /** `u_rimAmt` — how much of `rimGlow` lands at the boundary. */
  readonly rimAmt: number
  /** §4.5 / §5.2. Atlas freezes `u_time` at 0; adventure drifts at 30 fps. */
  readonly animated: boolean
}

/**
 * §5.2's atlas column, **verbatim and unused**. Capability `15` is its first reader.
 *
 * `maskScale` is deliberately absent: §5.2 gives atlas 0.75x, and the mask FBO is `0055`'s
 * `MASK_SCALE`, one module away. A second copy of that number here would be the drift D-153 exists
 * to catch. When capability 15 needs it, it moves `MASK_SCALE` into the mode — it does not add a
 * duplicate.
 */
export const ATLAS: FogPalette = {
  fogDeep: [0.1, 0.11, 0.14],
  fogEdge: [0.3, 0.32, 0.36],
  rimGlow: [0.85, 0.7, 0.42],
  maxOpacity: 0.55,
  noiseAmp: 0.1,
  rimAmt: 0.08,
  animated: false,
}

/** §5.2's adventure column, **verbatim and unused**. Same reason, same first reader. */
export const ADVENTURE: FogPalette = {
  fogDeep: [0.035, 0.045, 0.075],
  fogEdge: [0.22, 0.24, 0.3],
  rimGlow: [0.85, 0.7, 0.42],
  maxOpacity: 0.94,
  noiseAmp: 0.3,
  rimAmt: 0.3,
  animated: true,
}

/**
 * WHAT `0056` ACTUALLY SHIPS. The six values in the ticket's own table, exactly as written.
 *
 * Adventure's colours and opacity, atlas's noise and rim. See the header for why that is one
 * decision rather than two halves of a mode switcher.
 */
export const V1: FogPalette = {
  fogDeep: ADVENTURE.fogDeep,
  fogEdge: ADVENTURE.fogEdge,
  rimGlow: ADVENTURE.rimGlow,
  maxOpacity: ADVENTURE.maxOpacity,
  noiseAmp: ATLAS.noiseAmp,
  rimAmt: ATLAS.rimAmt,
  animated: true,
}

/* ─── The reveal ramp ───────────────────────────────────────────────────────── */

/**
 * §4.3's `smoothstep(0.30, 0.72, coverage + noise)`. Split out because `0055`'s `SEAM_FLOOR` is
 * DERIVED FROM `REVEAL_HI` and the derivation has to be checkable.
 *
 * `mask.ts` computes the floor a neighbour seam must clear as `REVEAL_HI + noiseAmp / 2`, using
 * **adventure's** 0.30 rather than the 0.10 that ships — the conservative half of the pair, because
 * capability 15 raising `noiseAmp` must not silently invalidate a mask constant that was measured
 * once on a GPU and never re-measured. `fog-uniforms.test.ts` asserts the two agree.
 */
export const REVEAL_LO = 0.3
/** The upper end of the reveal ramp. See `REVEAL_LO`. */
export const REVEAL_HI = 0.72

/* ─── The noise field ───────────────────────────────────────────────────────── */

/**
 * How many screen pixels one noise lattice cell spans. §4.3: *"The noise scale must not match the
 * parchment grain. Parchment grain is fine (~2-4 px), mist noise is coarse (~150-300 px). Matching
 * frequencies produces a beat pattern that looks like video compression artefacts"* (R4 §6.6).
 *
 * SCREEN pixels, at the zoom being looked at — not ground metres. The noise is anchored to the
 * ground (`composite.ts`, D-233) so it cannot crawl under a pan, but its *frequency* tracks the
 * map scale so a cell stays roughly this size on screen at every zoom. Anchored at a fixed ground
 * size instead, the field would be 16 px across at z10 — aliasing — and 4,000 px at z18 — a flat
 * wash.
 *
 * **ROUGHLY, since `0199`/D-243.** The frequency is now quantised to powers of two, so this is the
 * size at a whole zoom level and the true figure ranges over `NOISE_PX_MIN`..`NOISE_PX_MAX` in
 * between. Tracking the scale continuously re-randomised the entire field on every frame of a
 * zoom — see `quantiseNoiseScale` in `composite.ts` for why that follows from an integer hash.
 */
export const NOISE_PX = 260

/**
 * The band one lattice cell actually spans, given D-243's power-of-two quantisation: `NOISE_PX`
 * divided and multiplied by sqrt(2), because `Math.round` on a log2 splits each octave at its
 * geometric midpoint. **Measured, not asserted** — `composite.test.ts` sweeps the zoom and checks
 * the extremes land here, which is `0199`'s criterion 3.
 *
 * 184-368 px keeps the whole band inside §4.3's *"coarse (~150-300 px)"* at the fine end and only
 * modestly above it at the coarse end, which is why 2x was acceptable without an octave crossfade.
 */
export const NOISE_PX_MIN = NOISE_PX / Math.SQRT2
export const NOISE_PX_MAX = NOISE_PX * Math.SQRT2

/**
 * What a cell ACTUALLY measures at a whole zoom level: **256 px, not 260.**
 *
 * Both the lattice and the pixel grid are powers of two after D-243 — MapLibre's world is
 * `512 x 2^zoom x dpr` pixels and the quantised scale is `2^n` — so the ratio between them is a
 * power of two too, and `NOISE_PX`'s nearest one is 2^8. Independent of zoom AND of DPR; the
 * algebra cancels both. `composite.test.ts` asserts it at three zooms and two DPRs.
 *
 * 260 stays the constant of record because it is the *target* the quantisation rounds from, and
 * because §4.3's reasoning is about the 150-300 px band rather than any exact figure. Naming the
 * achieved value separately is what stops the next reader finding 256 and thinking it a bug.
 */
export const NOISE_PX_QUANTISED = 2 ** Math.round(Math.log2(NOISE_PX))

/**
 * The `#define` the ticket asks for: lever (c) of the three pre-decided performance levers, so
 * dropping to 2 octaves is one edit here rather than a shader rewrite.
 *
 * Levers in order, from the ticket: (a) mask scale to 0.35x — `MASK_SCALE` in `mask.ts`;
 * (b) animation to 20 fps — `FOG_FPS` below; (c) fBm to 2 octaves — this.
 */
export const FBM_OCTAVES = 3

/**
 * Lacunarity, and it is **exactly 2.0 rather than §4.3's 2.03 on purpose** (D-233).
 *
 * The sketch's 2.03 is the standard trick for stopping successive octaves from landing on the same
 * lattice and producing axis-aligned structure. It cannot be used here: the ground-anchored noise
 * carries an integer lattice origin that must survive being multiplied by the lacunarity at every
 * octave, and 2.03 x an integer is not an integer. `OCTAVE_JITTER` decorrelates the octaves
 * instead, which does the same job by translation rather than by frequency.
 */
export const FBM_LACUNARITY = 2

/**
 * A per-octave integer translation of the noise lattice, replacing 2.03's job. Any coprime-ish
 * integer pair works; these are two primes that are not near a multiple of each other, so octave 2
 * and octave 3 do not land back on octave 1's cells.
 */
export const OCTAVE_JITTER: readonly [number, number] = [17, 43]

/**
 * The second noise field's frequency multiplier. §4.3 sketches 2.7; **3.0 here**, for exactly
 * `FBM_LACUNARITY`'s reason — it multiplies the integer lattice origin and must leave it integral.
 * A 10% frequency difference in a field mixed at 0.35 is not a visible change.
 */
export const NOISE_FIELD_2_FREQ = 3

/**
 * How the two noise fields are mixed: `mix(n1, n2, NOISE_FIELD_MIX)`. §4.3 — the slow coarse field
 * shapes the boundary, the fast fine one animates wisps.
 */
export const NOISE_FIELD_MIX = 0.35

/** §4.3's drift velocities, in noise cells per second. The slow field. */
export const NOISE_DRIFT_1: readonly [number, number] = [0.013, 0.008]
/** §4.3's drift velocities, in noise cells per second. The fast field. */
export const NOISE_DRIFT_2: readonly [number, number] = [-0.021, 0.017]

/**
 * THE LATTICE ORIGIN IS REDUCED MODULO THIS. D-233, and the bound is arithmetic, not taste.
 *
 * The origin is an integer count of noise cells from mercator 0 and it grows with zoom: at z18 on a
 * DPR-2 display the map is ~537M drawing-buffer pixels wide, so ~2.1M cells. The shader adds the
 * origin to a lattice cell in a `float`, and a `float` represents integers exactly only to 2^24.
 * The largest multiplier applied to it is `NOISE_FIELD_2_FREQ x FBM_LACUNARITY^(FBM_OCTAVES-1)` =
 * 3 x 4 = 12, so the origin must stay under 2^24 / 12 = 1.4M. 2^20 is the largest power of two
 * below that, and a power of two is what makes the reduction exact.
 *
 * The cost is that the noise field repeats every 2^20 cells — 272M screen pixels, about the width
 * of the whole world at z18. `fog-uniforms.test.ts` asserts the headroom rather than trusting this
 * paragraph.
 */
export const NOISE_ORIGIN_MODULUS = 1 << 20

/* ─── Animation (§4.5) ──────────────────────────────────────────────────────── */

/**
 * §4.5: *"capped at 30 fps. Drifting mist does not benefit from 60 and it halves the battery
 * cost."* Lever (b) of the three: 20 here if the composite misses its budget.
 */
export const FOG_FPS = 30

/** Derived, so nothing computes `1000 / 30` in three places and rounds it differently. */
export const FOG_FRAME_MS = 1000 / FOG_FPS
