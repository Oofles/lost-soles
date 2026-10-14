import { REVEAL_HI, REVEAL_LO, V1_NOISE_AMP } from "@/lib/fog/fog-uniforms"
import { REVEAL_RAMP, type BloomUniform } from "@/lib/fog/mask"

/**
 * BEAT 1'S CLOCK. Ticket `0080`. `06-ui-ux.md` §3.2, to the frame:
 *
 *   0.0 – 0.4   the camera flies to the run (or does not move at all), fog frozen
 *   0.4 – 2.6   the lantern travels the route; the fog burns back behind it
 *   2.6 – 2.9   the lantern lands, settles, one soft pulse at the final point
 *
 * Pure: milliseconds since t=0 in, everything the frame needs out. Nothing here reads a clock,
 * touches the map or knows how long the run was — which is the whole of *"a 3 km run and a 20 km
 * run both take 2.2 s"*: the traversal is a fraction of the route by ARC LENGTH (`lantern-path.ts`),
 * and this module only ever speaks in that fraction.
 */

export const CAMERA_MS = 400
export const TRAVERSAL_MS = 2200
export const SETTLE_MS = 300
/** 2.9 s. Criterion 1. */
export const BEAT1_MS = CAMERA_MS + TRAVERSAL_MS + SETTLE_MS

/** §3.2's table: new ground blooms gold for 600 ms, remembered ground clears frost over 900 ms. */
export const GOLD_MS = 600
export const FROST_MS = 900

export type Beat1Phase = "camera" | "traversal" | "settle" | "done"

export interface Beat1Frame {
  phase: Beat1Phase
  /** The lantern's arc position AND `revealProgress`, `0..1` — one number, so the two cannot drift. */
  progress: number
  /** The mask's bloom uniform for this frame. */
  bloom: BloomUniform
  /** The settle's one soft pulse, `0..1..0`. 0 outside the settle. */
  pulse: number
  /** The lantern's opacity: lit for the traversal, out by the end of the settle. */
  lantern: number
  /**
   * `0085`. The trace web's cross-fade, `0..1`: the web without this run at 0, with it at 1. Held at
   * 0 until the lantern lands, then over the settle — the line joins the web as the light goes out.
   */
  web: number
}

export function easeOutCubic(x: number): number {
  const t = clamp01(x)
  return 1 - (1 - t) ** 3
}

/**
 * Where the beat is at `t` ms. Before 0 is the camera's first frame; at or past `BEAT1_MS` is
 * `done`, with every value at its settled end — progress 1, no bloom, no lantern.
 */
export function beat1At(t: number): Beat1Frame {
  const phase: Beat1Phase =
    t >= BEAT1_MS ? "done" : t >= CAMERA_MS + TRAVERSAL_MS ? "settle" : t >= CAMERA_MS ? "traversal" : "camera"

  // Linear in arc length: *"constant screen speed"*. An ease here would make pace the subject.
  const progress = clamp01((t - CAMERA_MS) / TRAVERSAL_MS)

  /**
   * The bloom clock is the traversal fraction UNCLAMPED: a cell cleared at the end of the route is
   * still blooming after the lantern lands. The settle fades every bloom out, because when beat 1
   * is the last beat it ends at 2.9 s and the reveal is uninstalled with it — a bloom cut off
   * mid-flush would read as a pop.
   */
  const settle = clamp01((t - CAMERA_MS - TRAVERSAL_MS) / SETTLE_MS)
  const bloom: BloomUniform =
    phase === "done" || phase === "camera"
      ? { clock: -1, fade: 0, goldSpan: GOLD_MS / TRAVERSAL_MS, frostSpan: FROST_MS / TRAVERSAL_MS }
      : {
          clock: (t - CAMERA_MS) / TRAVERSAL_MS,
          fade: 1 - settle * settle,
          goldSpan: GOLD_MS / TRAVERSAL_MS,
          frostSpan: FROST_MS / TRAVERSAL_MS,
        }

  const pulse = phase === "settle" ? Math.sin(Math.PI * settle) : 0
  const lantern = phase === "traversal" ? 1 : phase === "settle" ? 1 - settle : 0

  return { phase, progress, bloom, pulse, lantern, web: phase === "done" ? 1 : settle }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/**
 * `0084`. BEAT 1 UNDER `prefers-reduced-motion` (§3.4, `05` §4.5): no camera flight, no lantern, no
 * bloom — *"the reveal becomes a single 400 ms cross-fade from pre-run to post-run territory"*.
 *
 * The cross-fade is the same reveal seam, not a second renderer: `RunMoment` hands the layer the
 * run's cells with every arc at 0, and a cell at arc 0 is drawn at weight `progress / REVEAL_RAMP`
 * (`mask.ts`'s `revealed`), so every new cell fades in together.
 *
 * THE WEIGHT RAMPS ACROSS THE COMPOSITE'S THRESHOLD, NOT FROM 0 TO 1. Fog clears where coverage
 * crosses `smoothstep(REVEAL_LO, REVEAL_HI, coverage ± noise/2)` (`composite.ts`), so a weight ramped
 * linearly 0 → 1 changes nothing on screen for its first ~120 ms and is done by ~300 ms — a 170 ms
 * snap, seen in `0084`'s smoke. The ramp instead spans exactly the band the eye can see, noise
 * included, so the fog is visibly moving for the whole 400 ms (one pixel at the noise mean takes the
 * middle ~250 ms; the field's extremes take the ends). The first frame is the pre-run map (weight
 * 0), and at 400 ms the reveal is complete (progress 1, the steady state).
 */
export const REDUCED_BAND: readonly [number, number] = [REVEAL_LO - V1_NOISE_AMP / 2, REVEAL_HI + V1_NOISE_AMP / 2]

/*
 * The beat keeps its full 2.9 s: only the motion is removed, never the order (§3.4). The map holds,
 * lit and still, until beat 2 — so the map is seen before the numbers, for as long as it ever was.
 */
export const REDUCED_FADE_MS = 400

export function beat1ReducedAt(t: number): Beat1Frame {
  const phase: Beat1Phase = t >= BEAT1_MS ? "done" : t >= REDUCED_FADE_MS ? "settle" : "traversal"
  const fade = clamp01(t / REDUCED_FADE_MS)
  const [lo, hi] = REDUCED_BAND
  const weight = t <= 0 ? 0 : lo + (hi - lo) * fade
  return {
    phase,
    progress: fade >= 1 ? 1 : REVEAL_RAMP * weight,
    bloom: { clock: -1, fade: 0, goldSpan: GOLD_MS / TRAVERSAL_MS, frostSpan: FROST_MS / TRAVERSAL_MS },
    pulse: 0,
    lantern: 0,
    // Reduced: the web joins in the same 400 ms cross-fade as the fog.
    web: fade,
  }
}
