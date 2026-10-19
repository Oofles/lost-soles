import { DEFAULT_BASEMAP_VARIANT, type BasemapVariant } from "@/lib/basemap-style"
import { basemapFlag } from "@/lib/fog/debug-flags"
import { FOG_MODES, lerpPalette, type FogPalette } from "@/lib/fog/fog-uniforms"
import { RUN_GLOW_METRICS } from "@/lib/map-layers"

/**
 * THE ATLAS / ADVENTURE TOGGLE. Ticket `0098`, D-052, `05` §5.2–5.4, `06` §4.2–4.3.
 *
 * Three things live here, none of which touches MapLibre or React:
 *
 *   1. **The saved mode** — `localStorage`, per device, never synced (05 §5.3). A `?basemap=` flag
 *      outranks it, and it outranks the default (D-370).
 *   2. **What a mode draws, as numbers** — `ModeFrame`: the fog's uniforms and the route glow's
 *      opacity. Everything the cross-fade animates is in one frame, so one progress value moves
 *      all of it.
 *   3. **The 320 ms timeline** — one eased progress per animation frame, applied to the whole frame.
 *
 * WHAT IS *NOT* ON THE TIMELINE (operator, `0098` Q1 = B; D-NEW-c). The basemap variant swaps with a
 * diffed `setStyle` at the START of the fade (`swapBasemap`, `lib/basemap.ts`): atlas's road-fill
 * copies appear in one frame and labels change on MapLibre's own ~300 ms symbol fade. Labels and the
 * road copies move layer position across the fog (D-368), and no opacity animation of one layer
 * stack can do that. The fog's uniforms and the route glow — everything that CAN share a curve —
 * do.
 */

export type MapMode = BasemapVariant

export const DEFAULT_MAP_MODE: MapMode = DEFAULT_BASEMAP_VARIANT

/** The `localStorage` key. Namespaced like the camera's (`lib/map-camera.ts`). */
export const MAP_MODE_STORAGE_KEY = "lost-soles:map-mode"

/** The other mode. */
export function otherMode(mode: MapMode): MapMode {
  return mode === "atlas" ? "adventure" : "atlas"
}

/** The slice of `Storage` used. Every access is guarded: private windows throw, quota throws. */
export type ModeStorage = Pick<Storage, "getItem" | "setItem">

export function readSavedMode(storage: ModeStorage | null): MapMode | null {
  try {
    const raw = storage?.getItem(MAP_MODE_STORAGE_KEY)
    return raw === "atlas" || raw === "adventure" ? raw : null
  } catch {
    return null
  }
}

export function writeSavedMode(storage: ModeStorage | null, mode: MapMode): void {
  try {
    storage?.setItem(MAP_MODE_STORAGE_KEY, mode)
  } catch {
    // A viewing preference that fails to save costs one click next time, never the map.
  }
}

/** `?basemap=` (D-370), then the saved mode, then adventure (05 §5.3). */
export function initialMapMode(search: string, storage: ModeStorage | null): MapMode {
  return basemapFlag(search) ?? readSavedMode(storage) ?? DEFAULT_MAP_MODE
}

/* ─── The store ────────────────────────────────────────────────────────────── */

export interface MapModeStore {
  get(): MapMode
  /** Show `mode` and save it. */
  set(mode: MapMode): void
  toggle(): void
  subscribe(listener: () => void): () => void
}

/** One per page load. Read once, at creation, before the map is built (06 §4.2: before first paint). */
export function createMapModeStore(search: string, storage: ModeStorage | null): MapModeStore {
  let mode = initialMapMode(search, storage)
  const listeners = new Set<() => void>()
  const store: MapModeStore = {
    get: () => mode,
    set(next) {
      writeSavedMode(storage, next)
      if (next === mode) return
      mode = next
      for (const l of [...listeners]) l()
    },
    toggle: () => store.set(otherMode(mode)),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return store
}

let browserStore: MapModeStore | null = null

/** The browser's store, created on first use. `null` on the server, which has no saved mode. */
export function mapModeStore(): MapModeStore | null {
  if (typeof window === "undefined") return null
  if (!browserStore) {
    let storage: ModeStorage | null = null
    try {
      storage = window.localStorage
    } catch {
      storage = null
    }
    browserStore = createMapModeStore(window.location.search, storage)
  }
  return browserStore
}

/* ─── What a mode draws ────────────────────────────────────────────────────── */

/** Every value the cross-fade animates, in one place. */
export interface ModeFrame {
  /** The fog's per-mode uniforms (`FOG_MODES`). */
  readonly fog: FogPalette
  /**
   * The route glow's `line-opacity`. Adventure: §4.4's 0.35, the amber halo. Atlas: 0 — *"thin,
   * precise, above everything"* (05 §5.2), which is the 2.5 px cream core alone (operator, `0098` Q4).
   */
  readonly routeGlowOpacity: number
}

export const MODE_FRAMES: Readonly<Record<MapMode, ModeFrame>> = {
  atlas: { fog: FOG_MODES.atlas, routeGlowOpacity: 0 },
  adventure: { fog: FOG_MODES.adventure, routeGlowOpacity: RUN_GLOW_METRICS["line-opacity"] },
}

/** One frame between two, every value moved by the same `t`. */
export function lerpFrame(from: ModeFrame, to: ModeFrame, t: number): ModeFrame {
  return {
    fog: lerpPalette(from.fog, to.fog, t),
    routeGlowOpacity: from.routeGlowOpacity + (to.routeGlowOpacity - from.routeGlowOpacity) * t,
  }
}

/* ─── The timeline ─────────────────────────────────────────────────────────── */

/**
 * 320 ms, `0098` and `06` §4.3. Slower than a UI transition, faster than an animation you wait for.
 * Also the run page's fade back to the saved mode after the sequence (`06` §3.2, amended from 300).
 */
export const MODE_CROSSFADE_MS = 320

/**
 * CSS `ease-in-out`, `cubic-bezier(0.42, 0, 0.58, 1)` (06 §4.3), solved for y at x = t. ONE curve
 * for every animated value, so nothing in the frame arrives before anything else.
 */
export function easeInOut(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const x1 = 0.42
  const x2 = 0.58
  const bx = (u: number) => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u
  const by = (u: number) => 3 * (1 - u) * u * u + u * u * u // y1 = 0, y2 = 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (bx(mid) < t) lo = mid
    else hi = mid
  }
  return by((lo + hi) / 2)
}

export interface TimelineClock {
  now(): number
  requestAnimationFrame(cb: (nowMs: number) => void): number
  cancelAnimationFrame(handle: number): void
}

export interface ModeTransition {
  /** Stop where it is. The last applied frame stays applied. */
  cancel(): void
  /** The frame most recently applied — where a re-toggle mid-fade starts from. */
  current(): ModeFrame
}

/**
 * Run one cross-fade from `from` to `to`, calling `apply` with every frame and `done` once at the end.
 *
 * `reduced` (`prefers-reduced-motion`): a HARD CUT (06 §4.3 #3, D-NEW-b). `apply(to)` and `done()`
 * run synchronously and no animation frame is ever requested — `0098` criterion 7's spy.
 *
 * Elapsed time is measured from `clock.now()` at the call, against rAF timestamps — the same clock
 * in a browser — so the fade lasts 320 ms of wall time, not some number of frames.
 */
export function startModeTransition({
  from,
  to,
  reduced,
  clock,
  apply,
  done,
  ms = MODE_CROSSFADE_MS,
}: {
  from: ModeFrame
  to: ModeFrame
  reduced: boolean
  clock: TimelineClock
  apply: (frame: ModeFrame, progress: number) => void
  done?: () => void
  ms?: number
}): ModeTransition {
  let current = from
  let handle: number | null = null
  const finish = () => {
    current = to
    apply(to, 1)
    done?.()
  }
  if (reduced || ms <= 0) {
    finish()
    return { cancel() {}, current: () => current }
  }
  const t0 = clock.now()
  const tick = (now: number) => {
    handle = null
    const linear = (now - t0) / ms
    if (linear >= 1) {
      finish()
      return
    }
    const p = easeInOut(Math.max(0, linear))
    current = lerpFrame(from, to, p)
    apply(current, p)
    handle = clock.requestAnimationFrame(tick)
  }
  handle = clock.requestAnimationFrame(tick)
  return {
    cancel() {
      if (handle !== null) clock.cancelAnimationFrame(handle)
      handle = null
    },
    current: () => current,
  }
}

/* ─── The keyboard shortcut ────────────────────────────────────────────────── */

/**
 * `M` toggles the mode, except while a text field has focus (06 §4.2, D-253). No modifier: Ctrl+M,
 * Cmd+M and Alt+M belong to the browser and the OS. MapLibre's keyboard handler owns the arrows and
 * `+`/`−` and nothing with a letter, so there is no collision.
 */
export function isModeShortcut(event: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  repeat?: boolean
  target: unknown
}): boolean {
  if (event.key !== "m" && event.key !== "M") return false
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return false
  const t = event.target as { tagName?: string; isContentEditable?: boolean } | null
  if (t?.isContentEditable) return false
  const tag = t?.tagName?.toUpperCase()
  return tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT"
}
