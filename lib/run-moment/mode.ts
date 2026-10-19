import { DEFAULT_MAP_MODE, MODE_CROSSFADE_MS as CROSSFADE_MS, mapModeStore, type MapMode } from "@/lib/map-mode"

/**
 * THE RENDERING MODE AROUND THE SEQUENCE. Ticket `0080`, `06-ui-ux.md` §3.2: *"The sequence always
 * plays in adventure rendering, regardless of the user's saved mode … On completion it cross-fades
 * back to the saved mode."*
 *
 * `0098` gave this seam real answers: the saved mode is the toggle's (`lib/map-mode.ts`), and the
 * run page hands `MapShell` the mode to show — `SEQUENCE_MODE` while the sequence plays, then the
 * saved mode, or `FRONTIER_MODE` after a frontier click. `MapShell` runs the cross-fade, the same
 * 320 ms one the toggle uses (06 §3.2 amended from 300, operator, `0098` Q5).
 */

export type RenderMode = MapMode

/** What the sequence renders in, always. */
export const SEQUENCE_MODE: RenderMode = "adventure"

/** One fade for every mode change on the map (`lib/map-mode.ts`). */
export const MODE_CROSSFADE_MS = CROSSFADE_MS

/** The user's saved mode — the toggle's, per device. Adventure on the server, which has none. */
export function savedRenderMode(): RenderMode {
  return mapModeStore()?.get() ?? DEFAULT_MAP_MODE
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

/**
 * `0083`. §3.2 beat 5: the frontier line *"recentres the map there in atlas mode"*. `0098` honours it:
 * the run page shows this mode after the click. It is a request of this surface, not a change of the
 * saved preference — the toggle on `/` is where the user's own choice is made and kept.
 */
export const FRONTIER_MODE: RenderMode = "atlas"

/**
 * The mode the run page's map shows. A pure function of the page's state, so the sequence can
 * never play in anything but adventure, whatever was saved or clicked.
 */
export function runPageMode(state: { sequencePlaying: boolean; frontierClicked: boolean; saved: RenderMode }): RenderMode {
  if (state.sequencePlaying) return SEQUENCE_MODE
  return state.frontierClicked ? FRONTIER_MODE : state.saved
}
