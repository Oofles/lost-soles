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
 * so `ATLAS` and `ADVENTURE` both live here, in `FOG_MODES`, and the toggle (`0098`,
 * `lib/map-mode.ts`) cross-fades between them.
 *
 * ─── ADVENTURE IS WHAT `0056`/`0119` SHIPPED AS `V1` ─────────────────────────
 *
 * The single-rendering milestone shipped `V1`, `0119`'s tuning by eye over the real basemap. `0098`
 * made that tuning adventure's column (operator, Q2) rather than §5.2's original 0.94/0.30, so the
 * default mode looks exactly as it did before the toggle existed. `V1` remains as an alias.
 */

/** An RGB triple in linear-ish 0..1 shader space, as the shader's `vec3` uniforms take it. */
export type Rgb = readonly [number, number, number]

/** The six per-mode uniforms of §4.3. `u_mask`, `u_screen` and `u_time` are per-frame, not tunable. */
export interface FogPalette {
  /** `u_fogDeep` — the colour of ground nothing has revealed. */
  readonly fogDeep: Rgb
  /** `u_fogEdge` — lit mist, mixed toward as the noise field brightens. */
  readonly fogEdge: Rgb
  /** `u_rimGlow` — the warm light the fog is tinted toward near revealed ground (`0210`, `RIM_GLOW`). */
  readonly rimGlow: Rgb
  /**
   * `u_maxOpacity` — **never 1.0.** §4.3: letting 5-8% of the basemap bleed through is the whole
   * difference between *mist over a map* and *a hole cut in a black sheet*, and it is a direct
   * contribution to D-051 because even fully fogged ground keeps a ghost of its street grid.
   */
  readonly maxOpacity: number
  /** `u_noiseAmp` — how far the fBm field is allowed to displace the reveal threshold. */
  readonly noiseAmp: number
  /**
   * `u_rimAmt` — the lit band's strength at the frontier: how far the fog there mixes toward
   * `rimGlow`, and (times `RIM_THIN`) how much it thins. 0 is no rim. `0210`: 0..1, ships 0.9.
   */
  readonly rimAmt: number
  /**
   * `0100`. THE COLD WASH'S WEIGHT, 0..1 — how much of `coldWashOpacity` is drawn. Atlas 1,
   * adventure **0**, and that 0 is D-133 with no exceptions: at 0 the layer does not run the cold
   * pass at all, so adventure is byte-for-byte what it was. It is a palette entry so the mode
   * cross-fade (D-374, 320 ms) moves it on the same curve as everything else.
   */
  readonly coldWash: number
  /** §4.5 / §5.2. Atlas freezes `u_time` at 0; adventure drifts at 30 fps. */
  readonly animated: boolean
}

/* ─── The rim (ticket 0210) ───────────────────────────────────────── */

/*
 * THE RIM IS LIT MIST. The old rim added `rimGlow` to the fog colour and was then premultiplied by the
 * boundary's own ~0.45 alpha, so no `rimAmt` in §5.2's range could be seen (`0119`). The operator
 * chose, from three rendered designs (`docs/capabilities/assets/0210/`), a band of fog on the FOG
 * side of the frontier that is warmed toward `RIM_GLOW` and thinned, as if light from the cleared
 * ground were falling on the mist. It is zero on revealed ground by construction (D-051).
 *
 * Both modes share every rim number: the operator judged the design on one set of values in both.
 * They are declared before `ATLAS` because the palettes below reference them.
 */

/**
 * Warm lamplight, chosen for the STOCK `light` basemap (D-373). §5.1's "picks up the parchment hue"
 * no longer applies: there is no parchment, and the colour is chosen to read as light against dark
 * fog rather than to match the ground.
 */
export const RIM_GLOW: Rgb = [1.0, 0.78, 0.4]

/** How far the fog at the frontier mixes toward `RIM_GLOW`. 0 switches the rim off. */
export const RIM_AMT = 0.9

/**
 * The band's reach, in disc radii on the ground: about 21 m at res 11, which is the ~20 CSS px at z16
 * (at the operator's ~28.5°N, 1.05 m per CSS px) that was rendered and picked. Sized from the disc,
 * as D-372 sizes the warp, so the band is the same fraction of a corridor at every zoom.
 */
export const RIM_BAND_R = 0.55

/**
 * The ring blur's mean reveal is multiplied by this before clamping, so fog right at the frontier
 * (where only about half the ring lands on revealed ground) reaches full strength.
 */
export const RIM_GAIN = 1.5

/**
 * How much the lit band thins the fog, per unit of lit (`rimAmt` is already in it). At `RIM_AMT` 0.9
 * the fog at the frontier keeps 40% of its alpha. That is what lets the street grid show through
 * the band. Thinning only ever lowers alpha, so it can never veil cleared ground.
 */
export const RIM_THIN = 2 / 3

/** The ring blur's rings. The inner ring weighs most, so the light falls off away from the frontier. */
export const RIM_RINGS = 2

/** Taps per ring. `RIM_RINGS x RIM_TAPS_PER_RING` extra mask reads per fragment that is not fully revealed. */
export const RIM_TAPS_PER_RING = 8

/**
 * §5.2's atlas column, verbatim. Read by the mode toggle (`0098`, `FOG_MODES` below).
 *
 * `maskScale` is deliberately absent: both modes draw the mask at `0055`'s `MASK_SCALE` (0.5x).
 * §5.2 once gave atlas 0.75x; a resolution cannot be cross-faded and a change of it moves the edge,
 * which 05 §5.4 forbids, so the row was amended to one scale (`0098`, operator, Q3).
 */
export const ATLAS: FogPalette = {
  fogDeep: [0.1, 0.11, 0.14],
  fogEdge: [0.3, 0.32, 0.36],
  rimGlow: RIM_GLOW,
  maxOpacity: 0.55,
  noiseAmp: 0.1,
  rimAmt: RIM_AMT,
  coldWash: 1,
  animated: false,
}

/*
 * ─── `0119`'S TUNED VALUES — WHICH ARE ADVENTURE (`0098`) ─────────────────────
 *
 * Chosen by eye over the REAL basemap with labels at z16 (`tools/fog-harness/tune.mjs`), operator
 * approved 2026-09-28. Every one is inside §5.2's original atlas..adventure range; the seam budget
 * holds because `SEAM_FLOOR` is derived from `NOISE_AMP_CEILING` (0.30) and 0.25 is below it.
 *
 * `0098` made these ADVENTURE's values rather than §5.2's original column (0.94 / 0.30 / edge
 * 0.22,0.24,0.30): adventure is the default mode and this is the look the operator approved and
 * uses, so the toggle must not change it (operator, `0098` Q2; 05 §5.2 amended).
 */

/** Unchanged from §5.2: unexplored ground must read as dark and unknown, not greyed out. */
export const V1_FOG_DEEP: Rgb = [0.035, 0.045, 0.075]
/** Lighter than §5.2's (0.22,0.24,0.30) so the fBm density reads as mist, not a flat wash. */
export const V1_FOG_EDGE: Rgb = [0.27, 0.29, 0.35]
/** `0210`: the shared rim colour. See `RIM_GLOW`. */
export const V1_RIM_GLOW: Rgb = RIM_GLOW
/**
 * 0.90, down from 0.94, and **never 1.0.** A fully opaque fog reads as a hole punched in the map;
 * at 0.90 fogged ground keeps a readable ghost of its street grid and labels (D-051) while still
 * reading as dark. 0.94 hid that ghost almost completely on the stock basemap.
 */
export const V1_MAX_OPACITY = 0.9
/**
 * 0.25, up from 0.10. It displaces the boundary only ~5 m (D-231's formula), which costs no
 * legibility and buys what little raggedness this lever can buy. That is not enough to make the
 * edge ragged, so since `0211` (D-372) the edge warp below does that and this only animates wisps.
 */
export const V1_NOISE_AMP = 0.25
/**
 * `0210`: the shared rim strength. See `RIM_AMT`. (`0119` shipped 0.30 of the old glow, which could
 * not be seen at any value in range; that rim is gone.)
 */
export const V1_RIM_AMT = RIM_AMT

/** Adventure: `0119`'s tuned rendering — darkness and animation, tuned for legibility and texture. */
export const ADVENTURE: FogPalette = {
  fogDeep: V1_FOG_DEEP,
  fogEdge: V1_FOG_EDGE,
  rimGlow: V1_RIM_GLOW,
  maxOpacity: V1_MAX_OPACITY,
  noiseAmp: V1_NOISE_AMP,
  rimAmt: V1_RIM_AMT,
  coldWash: 0,
  animated: true,
}

/** The name the single-rendering milestone shipped under. Adventure, and only an alias of it. */
export const V1: FogPalette = ADVENTURE

/** The two map modes. Structurally `BasemapVariant`; restated so this module keeps zero imports. */
export type FogMode = "atlas" | "adventure"

/**
 * THE ONE EXPORTED CONSTANT MAP of per-mode uniforms (`0098` criterion 4). Everything that asks
 * "what does mode X draw the fog with" reads this; nothing else names a per-mode number.
 */
export const FOG_MODES: Readonly<Record<FogMode, FogPalette>> = { atlas: ATLAS, adventure: ADVENTURE }

/**
 * §4.3/§5.3: the fog never exceeds **0.94** in any mode, and never reaches 1.0. A ceiling, asserted
 * against every entry of `FOG_MODES` — `0098` criterion 5.
 */
export const MAX_OPACITY_CEILING = 0.94

/**
 * The largest `noiseAmp` any mode may take: §5.2's original adventure 0.30. `mask.ts`'s
 * `SEAM_FLOOR` was measured once on a GPU against this amplitude (D-231), so it is the bound, not
 * whatever a mode happens to ship.
 */
export const NOISE_AMP_CEILING = 0.3

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpRgb = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

/**
 * `0098`. One palette between two, at progress `t` (0 = `from`, 1 = `to`). Every scalar and every
 * channel moves by the same `t`, which is the cross-fade's "one timeline". `animated` is not
 * interpolated: freezing the clock is the toggle's to schedule (D-375, `map-mode.ts`).
 */
export function lerpPalette(from: FogPalette, to: FogPalette, t: number): FogPalette {
  return {
    fogDeep: lerpRgb(from.fogDeep, to.fogDeep, t),
    fogEdge: lerpRgb(from.fogEdge, to.fogEdge, t),
    rimGlow: lerpRgb(from.rimGlow, to.rimGlow, t),
    maxOpacity: lerp(from.maxOpacity, to.maxOpacity, t),
    noiseAmp: lerp(from.noiseAmp, to.noiseAmp, t),
    rimAmt: lerp(from.rimAmt, to.rimAmt, t),
    coldWash: lerp(from.coldWash, to.coldWash, t),
    animated: t < 1 ? from.animated : to.animated,
  }
}

/* ─── The reveal ramp ───────────────────────────────────────────────────────── */

/**
 * §4.3's `smoothstep(0.30, 0.72, coverage + noise)`. Split out because `0055`'s `SEAM_FLOOR` is
 * DERIVED FROM `REVEAL_HI` and the derivation has to be checkable.
 *
 * `mask.ts` computes the floor a neighbour seam must clear as `REVEAL_HI + noiseAmp / 2`, using
 * `NOISE_AMP_CEILING` (0.30) rather than either mode's amplitude, because a mode raising `noiseAmp`
 * must not silently invalidate a mask constant that was measured once on a GPU and never
 * re-measured. `fog-uniforms.test.ts` asserts the two agree.
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

/* ─── The edge warp (ticket 0211, D-372) ─────────────────────────────────── */

/*
 * WHY THE EDGE HAS ITS OWN NOISE. §4.3's threshold perturbation cannot make the edge ragged, and
 * no value of `noiseAmp` changes that. It moves the boundary by `amp/2 x (1 - FALLOFF_INNER) x radius`,
 * about 5 m against a 17 m ramp, so the union of discs still reads as a chain of circles (`0119`,
 * `0211`). Lowering `FALLOFF_INNER` would buy back the seam that D-231 removed. So the composite
 * moves the point where it SAMPLES the coverage mask instead. That moves the edge itself, by a
 * distance that does not depend on the ramp, and leaves every mask pixel as it was. The `run.mjs`
 * T3 seam probe, `SEAM_FLOOR` and `0079`'s R1/R2 zero-pixel diffs all measure the mask pass, so
 * none of them is touched.
 *
 * Both numbers below are in DISC RADII. That ties the warp to the ground and keeps the shape of the
 * revealed area accurate at every zoom. A warp held constant in screen pixels looked right at z16
 * and pushed a z14 corridor about 75 m off true, because a res-11 disc there is only about 9 px. The
 * operator picked these values by eye at z16 and z14 (`0211`'s variants F and H).
 */

/**
 * The warp's amplitude per unit of noise, in disc radii. The warp vector is `fbm - 0.5`, two fields,
 * and in practice spans roughly ±0.35. So the edge moves by up to about **±0.45 radius**, around
 * 17 m for a res-11 disc. That is under the 0.7 radius where a single-disc corridor's coverage is
 * still at least `SEAM_FLOOR`, so a lone corridor cannot be torn into holes.
 */
export const WARP_GAIN_R = 1.25

/**
 * The size of one warp lattice cell, as a target in disc radii, which sets the warp's base
 * wavelength. It is close to the 1.28-radius spacing between disc centres, which is what breaks up
 * the scallops: a much coarser warp only shifts a whole chain of circles sideways. The frequency is
 * rounded to a power of two (see `WARP_FREQ_MAX`), so the size actually used falls within √2 of this.
 */
export const WARP_WAVELENGTH_R = 1.75

/**
 * The frequency multiplier on D-233's lattice. It must be an integer, so that the lattice origin
 * stays integral when it is multiplied, and it is a power of two, so that `noiseScale x freq` (warp
 * cells per mercator unit) is the same at every zoom level that shares a bucket resolution. That is
 * what keeps the warp still through a pinch from z14 to z18: the warp field does not re-randomise at
 * all there, and re-randomises only where the bucket itself changes. The warp's origin is reduced
 * modulo `NOISE_ORIGIN_MODULUS` on the CPU, so the frequency never threatens the origin's exactness.
 * What 64 bounds is the LOCAL coordinate. At most about 10 noise cells x 64 x 4 (the lacunarity
 * over three octaves) is roughly 2,600, well inside what `fract` resolves. Below 1 the frequency is
 * clamped, so past about z18 the warp cell grows instead.
 */
export const WARP_FREQ_MAX = 64

/** Integer translations decorrelating the warp's two axes from each other and from the wisps. */
export const WARP_JITTER_X: readonly [number, number] = [101, 7]
/** See `WARP_JITTER_X`. */
export const WARP_JITTER_Y: readonly [number, number] = [29, 211]

/* ─── Animation (§4.5) ──────────────────────────────────────────────────────── */

/**
 * §4.5: *"capped at 30 fps. Drifting mist does not benefit from 60 and it halves the battery
 * cost."* Lever (b) of the three: 20 here if the composite misses its budget.
 */
export const FOG_FPS = 30

/** Derived, so nothing computes `1000 / 30` in three places and rounds it differently. */
export const FOG_FRAME_MS = 1000 / FOG_FPS

/* ─── Cold territory (ticket 0100) ──────────────────────────────────────────── */

/*
 * COLD GROUND IS NOT A THIRD FOG STATE. `06-ui-ux.md` §4.6, D-133, D-147. It is a wash painted only
 * INSIDE revealed ground, on a different perceptual channel from the frontier: the frontier is warm
 * luminance (D-379's lit mist, on the FOG side of the edge), cold ground is a cool multiply plus a
 * desaturation, two cell-widths inside the edge (the clip below). Atlas only — `coldWash` above.
 *
 * Driven from each cell's `lastRunDay` (D-120: a timestamp, never a presence bit), which the mask
 * pass writes into its ALPHA channel as warmth — see `mask.ts`'s `COLD_AGE_SPAN_DAYS`.
 */

/** `--cold-wash` `#7E93AD`, as the shader's 0..1 RGB. Multiplied over the lit basemap (06 §4.6). */
export const COLD_WASH_RGB: Rgb = [0x7e / 255, 0x93 / 255, 0xad / 255]

/** The ramp's asymptote: the most opaque the wash ever gets. Never raised to fix a look (0100 Notes). */
export const COLD_WASH_MAX = 0.18

/**
 * The saturation shift at the asymptote: CIELAB chroma (a*, b*) scaled by `1 - 0.18`, which is the
 * D-371 saturation C* ÷ √(C*² + L*²) lowered by ~18% on ground as unsaturated as the stock basemap's.
 * Scales with the wash, so it is 0 wherever the wash is 0.
 */
export const COLD_DESATURATE = 0.18

/** 6 months is 183 days (`SIX_MONTHS_MS`, `src/domain/discovery.ts`), so a month here is 30.5. */
export const COLD_DAYS_PER_MONTH = 183 / 6

/** The ramp is exactly 0 up to here (0100 criterion 3: "0.0 at ≤4 months"). */
export const COLD_RAMP_START_MONTHS = 4

/** The tabled value at the 6-month line, where D-120 re-arms ground for 50% discovery credit. */
export const COLD_WASH_AT_COOLDOWN = 0.1

/**
 * The ramp's width, DERIVED so the curve passes through `COLD_WASH_AT_COOLDOWN` at 6 months:
 * `0.18 × (1 − exp(−(2/τ)²)) = 0.10`, τ ≈ 2.221 months.
 */
export const COLD_RAMP_TAU_MONTHS =
  (6 - COLD_RAMP_START_MONTHS) / Math.sqrt(-Math.log(1 - COLD_WASH_AT_COOLDOWN / COLD_WASH_MAX))

/**
 * THE RAMP. `06` §4.6's chart: 0 until month 4, rising through month 5 (≈0.03, ground "coming back
 * into season"), 0.10 at month 6, ≈0.179 by month 9, asymptotic to 0.18.
 *
 *     opacity(m) = 0.18 × (1 − exp(−((m − 4) / τ)²))   for m > 4, else 0
 *
 * A Gaussian-CDF-like shoulder rather than a straight line or a step: it is continuous everywhere
 * AND its derivative is (0 on both sides of month 4, finite everywhere else), so there is no
 * visible onset line on the map, and no discontinuity at the 6-month boundary (criterion 4). The
 * composite shader computes exactly this; `composite.test.ts` holds the two together.
 */
export function coldWashOpacity(ageDays: number): number {
  if (!(ageDays > 0)) return 0
  const m = ageDays / COLD_DAYS_PER_MONTH - COLD_RAMP_START_MONTHS
  if (m <= 0) return 0
  const x = m / COLD_RAMP_TAU_MONTHS
  return COLD_WASH_MAX * (1 - Math.exp(-x * x))
}

/**
 * THE CLIP RULE, `06` §4.6 — the whole trick, in one line: `smoothstep(0.0, 0.25, coverage − 0.75)`.
 * Exactly 0 wherever the (warped, D-372) coverage is ≤ 0.75, so a band of plain revealed ground
 * always separates cold ground from the frontier. TS mirror of the shader's line, for the tests.
 */
export function coldClip(coverage: number): number {
  const t = Math.min(1, Math.max(0, (coverage - 0.75) / 0.25))
  return t * t * (3 - 2 * t)
}

/**
 * 06 §4.6's "soft, 40 px feather, no defined edge": a ring blur of the cold field whose reach is half
 * the feather (a blur of radius R turns a step into a ramp 2R wide). CSS pixels; the layer scales it
 * by the device pixel ratio. The taps are `0210`'s ring pattern (`rimTaps`), reused.
 */
export const COLD_FEATHER_PX = 40
