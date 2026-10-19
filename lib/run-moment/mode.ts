import { DEFAULT_MAP_MODE, MODE_CROSSFADE_MS as CROSSFADE_MS, mapModeStore, type MapMode } from "@/lib/map-mode"
import type { ExitCause } from "./exit"

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

/**
 * `0254`. THE HAND-BACK. How the sequence ended decides how the map leaves adventure (06 §3.2): a
 * sequence that ran to its end (or aborted — both `complete`) cross-fades to the saved mode over
 * the toggle's 320 ms (D-378); a skip — click, Esc or Back (`0084`) — is *"instantly, no fade"*, so
 * the saved mode arrives in one frame. `null` when the saved mode is adventure: nothing changes.
 *
 * `saved` is the user's saved mode, never the run page's frontier override: the frontier click
 * does not change the preference (D-378), and `onRelive` clears it before the next play.
 */
export function modeCrossFade(saved: RenderMode, cause: ExitCause = "complete"): ModeCrossFade | null {
  if (saved === SEQUENCE_MODE) return null
  return { from: SEQUENCE_MODE, to: saved, ms: handBackFadeMs(cause) }
}

/** The hand-back's fade, in ms, after an exit of this cause: 0 for a skip, 320 otherwise. */
export function handBackFadeMs(cause: ExitCause | null): number {
  return cause === null || cause === "complete" ? MODE_CROSSFADE_MS : 0
}

/**
 * The fade `MapShell` uses for the run page's NEXT mode change. A frontier click always fades (a
 * toggle-like change, `0098`); otherwise it is the hand-back's, set by how the last play ended —
 * `null` while none has, so the change into a Relive keeps the 320 ms fade it had.
 */
export function runPageFadeMs(state: { frontierClicked: boolean; endCause: ExitCause | null }): number {
  return state.frontierClicked ? MODE_CROSSFADE_MS : handBackFadeMs(state.endCause)
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
