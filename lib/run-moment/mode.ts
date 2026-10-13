/**
 * THE RENDERING MODE AROUND THE SEQUENCE. Ticket `0080`, `06-ui-ux.md` §3.2: *"The sequence always
 * plays in adventure rendering, regardless of the user's saved mode … On completion it cross-fades
 * (300 ms) back to the saved mode."*
 *
 * A STUB, AND DELIBERATELY ONE (D-295). No saved mode exists yet: the milestone ships ONE rendering,
 * `V1` in `lib/fog/fog-uniforms.ts`, which is adventure's darkness and animation, and atlas's first
 * reader is capability 15. So the beat already plays in adventure, the saved mode is always adventure,
 * and the cross-fade has nothing to fade to. This module holds the seam so capability 15 has one place
 * to change: give `savedRenderMode` a real answer, and apply the fade `modeCrossFade` describes.
 */

export type RenderMode = "adventure" | "atlas"

/** What the sequence renders in, always. */
export const SEQUENCE_MODE: RenderMode = "adventure"

export const MODE_CROSSFADE_MS = 300

/** The user's saved mode. Always adventure until capability 15 adds the setting. */
export function savedRenderMode(): RenderMode {
  return "adventure"
}

export interface ModeCrossFade {
  from: RenderMode
  to: RenderMode
  ms: number
}

/** The fade to run when the beat ends — `null` when the saved mode is the one already showing. */
export function modeCrossFade(saved: RenderMode): ModeCrossFade | null {
  return saved === SEQUENCE_MODE ? null : { from: SEQUENCE_MODE, to: saved, ms: MODE_CROSSFADE_MS }
}
