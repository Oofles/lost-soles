"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { basemapStyle, registerPmtilesProtocol, swapBasemap } from "@/lib/basemap"
import { REDUCED_MOTION_QUERY } from "@/lib/fog/animation"
import { perfEnabled, revealScrubEnabled } from "@/lib/fog/debug-flags"
import type { HOLD_PENDING } from "@/lib/fog/home-territory"
import type { FogMaskLayer } from "@/lib/fog/mask-layer"
import { createFogHarness, type FogHarness } from "@/lib/fog/perf/harness"
import { revealCellsForRoute, type RevealCell } from "@/lib/fog/reveal"
import {
  cameraKey,
  EXTRACT_FALLBACK,
  firstLoadRunCamera,
  parseAt,
  readCamera,
  runBounds,
  runCamera,
  writeCamera,
  type Camera,
} from "@/lib/map-camera"
import { lockOrientation, MAP_INPUT_OPTIONS, settleZoom, ZOOM_SETTLE_MS } from "@/lib/map-controls"
import { RUN_GLOW_ID, RUN_SOURCE_ID } from "@/lib/map-layers"
import { MODE_FRAMES, startModeTransition, type MapMode, type ModeFrame, type ModeTransition } from "@/lib/map-mode"
import { log } from "@/lib/log"
import { selectedCollection, type IndexedRun } from "@/lib/route-inspect"
import type { RunFeatureCollection } from "@/lib/runs/wire"
import { RUN_PAGE_TRACE_K } from "@/lib/trace-web/layer"

import { MapControls } from "./map-controls"
import { MaskHud } from "./mask-hud"
import { PerfOverlay } from "./perf-overlay"
import { RegionJump } from "./region-jump"
import { RevealScrub } from "./reveal-scrub"
import { useMarkMapPainted } from "./explored-provider"
import { useFogMask } from "./use-fog-mask"
import { useLandmarks } from "./use-landmarks"
import { useLatestRun, type LatestAnswer } from "./use-latest-run"
import { useTraceWeb } from "./use-trace-web"
import { useMapMode } from "./use-map-mode"

import "maplibre-gl/dist/maplibre-gl.css"

/**
 * The map. Ticket 0053, `09-roadmap.md` §2.3.
 *
 * A plain MapLibre map, plus 0055's fog mask layer via `useFogMask` — no plinth, no chrome.
 * `05-fog-of-war.md` §4.6 rules out deck.gl explicitly ("correct architecture, wrong ergonomics": the mask is
 * a boolean in the fragment shader, so no feather, no alpha ramp, no noise hook, and
 * fixing it means forking a ~500 KB dependency's shader module). `scripts/check-no-deckgl.mjs`
 * keeps it out of the lockfile so that stays true without anyone remembering it.
 */

/**
 * MAPLIBRE IS IMPORTED INSIDE THE EFFECT, not at module scope.
 *
 * `next/dynamic` with `ssr: false` is the documented route and cannot be used from a
 * Server Component in Next 15, which would mean an extra client wrapper whose only job is
 * to hold the dynamic call. An `await import()` in an effect reaches the same place with
 * less machinery: effects do not run during SSR, so the WebGL bundle never enters the
 * server render and never enters the initial payload.
 */
type MapLibre = typeof import("maplibre-gl")
type MapInstance = import("maplibre-gl").Map

/**
 * `0080`. WHAT THE SHELL TELLS WHOEVER IS PLAYING OVER IT — beat 1, which lives outside the shell
 * (`RunSequence`) and drives the map imperatively. `null` while the map is loading; `unsupported`
 * when there will never be one, so the sequence can give up at once rather than wait forever.
 * `layer` is `null` under `?fog=off`.
 *
 * `0084`. `lost` from `webglcontextlost` until `webglcontextrestored`: the canvas is blank and every
 * GL call a no-op, so the sequence aborts to the end state and the run page shows a still in its place.
 */
export type MapStage =
  | { kind: "ready"; map: MapInstance; layer: FogMaskLayer | null }
  | { kind: "unsupported" }
  | { kind: "lost" }
  | null

/**
 * WebGL2 is checked BEFORE the map is constructed, because `05-fog-of-war.md` §9.6 is
 * explicit that there is no fallback path: `gl.blendEquation(gl.MAX)` and `R8` render
 * targets are WebGL2-only, MapLibre 6 is WebGL2-only, and "the app is simply unusable on a
 * device without WebGL2". Without this check that reads as a blank rectangle, which is
 * indistinguishable from a broken basemap or a bad build.
 */
function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement("canvas")
    return canvas.getContext("webgl2") !== null
  } catch {
    return false
  }
}

const shell: React.CSSProperties = {
  /**
   * `100dvh`, not `100vh`. On Android Chrome `100vh` is the viewport with the URL bar
   * hidden, so a `100vh` canvas is taller than the visible area and the page scrolls to a
   * gutter under the map — the "white gutter at the bottom on the phone's browser chrome"
   * this ticket's operator validation looks for.
   */
  position: "fixed",
  inset: 0,
  height: "100dvh",
  width: "100%",
  background: "var(--bg)",
}

const notice: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  padding: "2rem",
  color: "var(--text-primary)",
  background: "var(--bg)",
  font: "500 1rem/1.5 system-ui, sans-serif",
  textAlign: "center",
}

/**
 * `0078`. `/run/:id`'s map: a box at the top of a scrolling page rather than the whole screen, and
 * the same component otherwise — fog, route layers, context-loss rebuild — so the run page's map
 * cannot drift from home's.
 */
const framedShell: React.CSSProperties = {
  position: "relative",
  height: "55vh",
  minHeight: "16rem",
  width: "100%",
  background: "var(--bg)",
}

const NO_CELLS: readonly string[] = []

/**
 * `0098`. ONE FRAME OF A MODE ON THE MAP: the fog's uniforms and the route glow's opacity, both off
 * the same `ModeFrame`, so a cross-fade moves them together. Nothing here moves the camera.
 */
function applyModeFrame(map: MapInstance, layer: FogMaskLayer | null, frame: ModeFrame): void {
  layer?.setPalette(frame.fog)
  try {
    if (map.getLayer(RUN_GLOW_ID)) map.setPaintProperty(RUN_GLOW_ID, "line-opacity", frame.routeGlowOpacity)
  } catch {
    // A map mid-teardown. The next build starts from the mode, not from this frame.
  }
  map.triggerRepaint()
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION_QUERY).matches
}

export function MapShell({
  home,
  run,
  reveal: sequenceReveal = null,
  onStage,
  paneClassName,
  onLatestRun,
  held = null,
  mode: modeProp,
  modeFadeMs,
}: {
  home: Camera | null
  /**
   * `0078`. ONE RUN'S PAGE. When given, the map is framed on this run, draws this run's line
   * instead of fetching the latest, and leaves the stored camera alone in both directions: it does
   * not open where home was left, and panning here does not move where home opens next.
   *
   * No animation of any kind on the way in — `fitBounds` with `animate: false`. The camera flight
   * is beat 1's (`0080`), and the static end state must not borrow it.
   */
  run?: RunFeatureCollection
  /**
   * `0080`. Beat 1's reveal set — this run's new and re-armed cells, from the server (`0251`) — while
   * the sequence plays, `null` otherwise. Installed at progress 0 and driven by the sequence through
   * `onStage`'s layer. `?fog=scrub` outranks it: a debug view replaces the sequence's set, it never
   * mixes with it.
   */
  reveal?: readonly RevealCell[] | null
  /** `0080`. The map and its fog layer, as they become available. See `MapStage`. */
  onStage?: (stage: MapStage) => void
  /**
   * `0086`. HOME'S PANE. A class that positions the map container instead of the full-window
   * `shell` style: at ≥1024px the map is a pane beside the plinth's rail (`06` §2.1, D-313), and
   * inline styles cannot hold a media query. MapLibre's container IS the pane, so the camera needs
   * no offset for the rail — D-249's framing centres in what is visible.
   */
  paneClassName?: string
  /**
   * `0086`. The latest traced run, each time `useLatestRun` has one — the plinth's last-run line
   * reads it, so the line and the first camera can never name different runs, and `/` makes one
   * request for it, not two. Home only; a run's page never calls it.
   */
  onLatestRun?: (runs: RunFeatureCollection, answer: LatestAnswer | null) => void
  /**
   * `0087`. HOME ONLY. While the latest run is UNSEEN, its new cells — held back so `/` shows
   * territory as of before the run (`06` §2.4) — and, by being non-null at all, the corridor off
   * too. `null`: nothing held. Pass a stable identity.
   *
   * `0273`: `HOLD_PENDING` while the hold for the explored set as it now stands is not known (the
   * latest-run answer `onLatestRun` hands up does not speak for it yet): the fog keeps its last
   * frame, and the corridor stays off.
   */
  held?: readonly string[] | typeof HOLD_PENDING | null
  /**
   * `0098`. THE MODE TO SHOW. Absent on `/`, which shows the saved mode (`lib/map-mode.ts`); the run
   * page passes its own — adventure while the sequence plays, the saved mode after, atlas after a
   * frontier click (`06` §3.2). A change cross-fades in 320 ms; the camera never moves.
   */
  mode?: MapMode
  /**
   * `0254`. The fade, in ms, for the NEXT change of `mode` — read when the change lands. Absent:
   * the toggle's 320 ms. The run page passes 0 after a skip, whose hand-back to the saved mode is
   * *"instantly, no fade"* (`06` §3.2, `0084`). Reduced motion is a hard cut whatever this says.
   */
  modeFadeMs?: number
}) {
  const framed = run !== undefined
  const fixedRun = useRef(run)
  fixedRun.current = run
  /**
   * `0278`. The build effect is keyed on home's VALUE (`cameraKey`), not its identity: the server
   * hands down a new, value-equal `home` on every `router.refresh()`, and rebuilding MapLibre for
   * one tears down the map, its camera and its fog layer for no change at all. The effect reads
   * the object through this ref, as it reads the run through `fixedRun`.
   */
  const homeKey = cameraKey(home)
  const fixedHome = useRef(home)
  fixedHome.current = home
  const container = useRef<HTMLDivElement | null>(null)
  const map = useRef<MapInstance | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  /** `0084`. The GL context is gone and not yet back. Reported as `MapStage` `lost`. */
  const [lost, setLost] = useState(false)
  /**
   * THE LOADED MAP, IN STATE AND NOT ONLY IN THE REF ABOVE. Ticket 0055.
   *
   * `useFogMask` has to add a custom layer, and `addLayer` needs a style that has finished loading
   * — so it needs both a re-render when that happens and a new identity when a context-loss rebuild
   * constructs a different Map. A ref gives neither. It is set on `load` and cleared in `teardown`,
   * which is what makes the layer's lifetime exactly the map's.
   */
  const [loaded, setLoaded] = useState<MapInstance | null>(null)

  /**
   * `0098`. THE MODE. `wanted` is what should be on screen; `shown` is the variant the current Map
   * was built or last swapped with; `frame` is the uniforms and glow opacity applied right now,
   * mid-fade included. Refs: a cross-fade writes 20 frames in 320 ms and none of them is a render.
   */
  const savedMode = useMapMode()
  const wanted: MapMode = modeProp ?? savedMode
  const wantedRef = useRef(wanted)
  wantedRef.current = wanted
  /** `0254`. A ref: a change of the fade alone is not a mode change and must not start one. */
  const fadeMsRef = useRef(modeFadeMs)
  fadeMsRef.current = modeFadeMs
  const shown = useRef<MapMode | null>(null)
  const frame = useRef<ModeFrame>(MODE_FRAMES[wanted])
  const transition = useRef<ModeTransition | null>(null)
  /** The SETTLED mode's clock — flips to frozen when a fade to atlas ends, to running when one to adventure starts. */
  const [fogAnimated, setFogAnimated] = useState(MODE_FRAMES[wanted].fog.animated)

  /**
   * The camera is held in a ref as well as in `localStorage` so that a context-loss
   * rebuild can restore where the operator actually was, not where they were when the
   * last `moveend` fired.
   */
  const camera = useRef<Camera>(home ?? EXTRACT_FALLBACK)

  /**
   * Ticket `0186`. What `firstLoadRunCamera` needs to decide whether the most recent run may move
   * the camera. Refs, not state: none of them is rendered, and a context-loss rebuild must not
   * reset them — the operator's pan before the rebuild still counts as a pan.
   */
  const storedAtMount = useRef(false)
  const userMoved = useRef(false)
  const centredOnRun = useRef(false)

  /**
   * `0059`. ONE HARNESS PER MOUNT, and `null` unless `?fog=perf` is on the URL.
   *
   * Built here rather than inside `useFogMask` because two things need it and they are in different
   * trees: the hook threads it into the store, the controller and the layer, and `PerfOverlay` reads
   * its snapshot. `useMemo` with an empty dependency list rather than `useRef` because the flag is
   * read once — see `use-fog-mask.ts` on why a debug flag is not watched.
   */
  const harness: FogHarness | null = useMemo(
    () =>
      typeof window !== "undefined" && perfEnabled(window.location.search)
        ? createFogHarness()
        : null,
    [],
  )

  useEffect(() => {
    if (!hasWebGL2()) {
      setUnsupported(true)
      return
    }

    const stored = framed ? null : readCamera()
    // Stored beats configured home: the ticket wants the FIRST-EVER load centred on home,
    // not every load. After that the operator's own last position is the better answer.
    // `0078`: a run's page starts on the run. (A context-loss rebuild calls `build` directly, not
    // this effect, so it keeps wherever the operator had panned to.)
    const home = fixedHome.current
    camera.current = framed
      ? (runCamera(fixedRun.current!) ?? home ?? EXTRACT_FALLBACK)
      : (stored ?? home ?? EXTRACT_FALLBACK)
    storedAtMount.current = stored !== null

    let disposed = false
    let maplibre: MapLibre | null = null
    let resizeObserver: ResizeObserver | null = null

    /**
     * A full teardown and rebuild, which is what `webglcontextrestored` needs and what the
     * ticket asks for ("rebuild programs, VAOs and FBOs"). MapLibre owns all three, and it
     * has no public API to rebuild them in place — so the honest implementation of "rebuild"
     * is to construct a new Map. Doing it now, while the map is plain, is the ticket's
     * stated reason for handling context loss this early: 0055's custom layer will own GPU
     * resources of its own, and retrofitting a rebuild path around it is much harder.
     */
    function build(lib: MapLibre) {
      if (disposed || !container.current) return

      /**
       * `lib` itself, not `lib.default`. MapLibre 6 is ESM-only and exports `addProtocol`
       * and `Map` as NAMED exports with no default export at all — an assumption worth
       * stating, because the v5 idiom is `maplibregl.addProtocol` off a default import and
       * it fails here as a type error rather than at runtime.
       */
      /**
       * WITHOUT THIS THE MAP RENDERS ITS BACKGROUND AND NOTHING ELSE.
       *
       * MapLibre 6 derives its worker URL from `import.meta.url`, which webpack
       * inlines at BUILD time as `file:///…/node_modules/maplibre-gl/dist/…`. That is
       * not `http(s):`, so MapLibre's own guard returns the empty string, the browser
       * resolves "" against the current page, and the server answers with the app's
       * HTML — "Failed to load module script: non-JavaScript MIME type text/html".
       *
       * The style still loads on the main thread, so the background layer paints and
       * nothing is ever parsed into a tile: a flat #cccccc screen. Nothing about that
       * symptom points at a worker, which is why the mechanism is written out here and
       * in scripts/copy-maplibre-worker.mjs rather than summarised.
       */
      lib.setWorkerUrl("/maplibre/maplibre-gl-worker.js")

      registerPmtilesProtocol(lib)

      // `0098`. The mode on screen NOW — saved, flagged (`?basemap=`, D-370) or the run page's — and
      // its frame, so a context-loss rebuild comes back in the mode it left, settled, not mid-fade.
      const initialMode = wantedRef.current
      shown.current = initialMode
      transition.current?.cancel()
      transition.current = null
      frame.current = MODE_FRAMES[initialMode]
      const instance = new lib.Map({
        container: container.current,
        style: basemapStyle(initialMode),
        center: [camera.current.lng, camera.current.lat],
        zoom: camera.current.zoom,
        /**
         * `0101`. North-up, always, and flat — whatever a camera stored before the lock says. The
         * rotation and tilt handlers are off in `MAP_INPUT_OPTIONS`, at the options level (§4.4).
         */
        bearing: 0,
        pitch: 0,
        ...MAP_INPUT_OPTIONS,
        /**
         * `Math.min(devicePixelRatio, 2)` — the ticket's cheapest mobile win. A 3x phone
         * gains essentially nothing on a soft mist effect and costs 2.25x the composite
         * fragments once 0056 lands.
         */
        pixelRatio: Math.min(window.devicePixelRatio, 2),
        attributionControl: { compact: false },
      })

      // `0101`. The two rotations MapLibre has no option for: Shift+arrows and a two-finger twist.
      lockOrientation(instance)

      map.current = instance
      // `once`, not `on`: a style change re-fires `load`, and a second setState with the same
      // instance would remount the fog layer for no reason.
      instance.once("load", () => setLoaded(instance))

      // `0078`. Framed on the whole run, with §3.2's 12% padding, and no flight.
      const box = framed && !userMoved.current ? runBounds(fixedRun.current!) : null
      if (box) {
        const canvasBox = container.current.getBoundingClientRect()
        const pad = Math.round(Math.min(canvasBox.width, canvasBox.height) * 0.12)
        instance.fitBounds(box, { padding: pad, animate: false, maxZoom: 17 })
      }

      // `originalEvent` is present only for a gesture — a drag, a wheel, a pinch. The `jumpTo` below
      // fires `movestart` too, without one, and must not count as the operator moving the map.
      instance.on("movestart", (event) => {
        if (event.originalEvent) userMoved.current = true
      })

      instance.on("moveend", () => {
        /**
         * `0101`. THE RUBBER BAND. A gesture may carry the zoom half a level past z10 or z18
         * (`MAP_INPUT_OPTIONS`); on release it eases back inside, so neither bound hard-stops
         * (§4.4). The settle's own `moveend` is the one that stores the camera.
         */
        const settled = settleZoom(instance.getZoom())
        if (settled !== null) {
          instance.easeTo({ zoom: settled, duration: prefersReducedMotion() ? 0 : ZOOM_SETTLE_MS })
          return
        }
        const centre = instance.getCenter()
        camera.current = {
          lng: centre.lng,
          lat: centre.lat,
          zoom: instance.getZoom(),
          bearing: 0,
        }
        if (!framed) writeCamera(camera.current)
      })

      const canvas = instance.getCanvas()

      /**
       * preventDefault is what makes restoration possible at all — without it the browser
       * never fires `webglcontextrestored`. On a phone this happens for real when the tab
       * is backgrounded under memory pressure.
       */
      canvas.addEventListener("webglcontextlost", onLost, false)
      canvas.addEventListener("webglcontextrestored", onRestored, false)

      /**
       * MapLibre listens to `window.resize`, which fires late or not at all for the two
       * cases that matter on a phone: an orientation change that keeps the window size
       * momentarily identical, and the URL bar collapsing. Observing the container is the
       * reliable signal, and it is what keeps the canvas from stretching.
       */
      resizeObserver = new ResizeObserver(() => instance.resize())
      resizeObserver.observe(container.current)
    }

    function onLost(event: Event) {
      event.preventDefault()
      setLost(true)
    }

    function onRestored() {
      if (disposed || !maplibre) return
      setLost(false)
      teardown()
      build(maplibre)
    }

    function teardown() {
      setLoaded(null)
      resizeObserver?.disconnect()
      resizeObserver = null
      const instance = map.current
      map.current = null
      if (!instance) return
      const canvas = instance.getCanvas()
      canvas?.removeEventListener("webglcontextlost", onLost)
      canvas?.removeEventListener("webglcontextrestored", onRestored)
      try {
        instance.remove()
      } catch {
        // `remove()` touches the GL context, which is exactly what has just gone away.
        // A throw here is expected on the context-loss path and means the work is done.
      }
    }

    void (async () => {
      const lib = await import("maplibre-gl")
      if (disposed) return
      maplibre = lib
      build(lib)
    })()

    return () => {
      disposed = true
      teardown()
    }
  }, [homeKey, framed])

  /**
   * `0079`. `?fog=scrub` on a run's page: this run's reveal set, computed from the route the page
   * already holds — no fetch. Every cell the run touched, including ground earlier runs cleared:
   * which of them are THIS run's discoveries is the server's to say (`0251`), and beat 1 (`0080`)
   * passes exactly those, through `reveal`. For judging how the edge reads, the whole route is the better test anyway.
   *
   * Read once, for `use-fog-mask.ts`'s reason: a debug flag is not watched.
   */
  const scrub = useMemo(
    () => framed && typeof window !== "undefined" && revealScrubEnabled(window.location.search),
    [framed],
  )
  const reveal: RevealCell[] | null = useMemo(
    () => (scrub && run?.features[0] ? revealCellsForRoute(run.features[0].geometry) : null),
    [scrub, run],
  )

  /**
   * Ticket 0055 — pass 1. The hook owns the layer's lifetime and its data; the shell owns the map.
   * Called unconditionally and before the early return below, because hooks are.
   */
  /**
   * `0087`. Home's fog rules — hold an unseen run back, and no territory means no fog layer at all
   * (`lib/fog/home-territory.ts`). `null` on a run's page, which plays its reveal over any set.
   */
  const homeFog = useMemo(() => (framed ? null : { hold: held ?? NO_CELLS }), [framed, held])
  /** `0100`: `coldTerritory` asks for the lastRun sidecar the first time the wanted mode draws cold ground. */
  const coldTerritory = MODE_FRAMES[wanted].fog.coldWash > 0
  const look = useMemo(
    () => ({ palette: () => frame.current.fog, animated: fogAnimated, coldTerritory }),
    [fogAnimated, coldTerritory],
  )
  const fogLayer = useFogMask(loaded, harness, reveal ?? sequenceReveal, reveal ? 1 : 0, homeFog, look)
  const fogLayerRef = useRef(fogLayer)
  fogLayerRef.current = fogLayer

  /**
   * `0113`, `06` §9.5: THE MAP HAS PAINTED, SO THE FOG MAY NOW ASK THE NETWORK. MapLibre's `load` is
   * its first visually complete render; `useFogMask` (declared above, so its effect runs first) adds
   * the fog layer on the same commit, and two frames later that layer has drawn the cached set. A map
   * that cannot paint at all opens the gate at once — there is no paint to protect. The provider's
   * ceiling covers a map that never reaches either (`lib/fog/paint-gate.ts`).
   */
  const markPainted = useMarkMapPainted()
  useEffect(() => {
    if (unsupported) {
      markPainted()
      return
    }
    if (!loaded) return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => markPainted())
    })
    return () => cancelAnimationFrame(frame)
  }, [loaded, unsupported, markPainted])

  /**
   * `0098`. A MODE CHANGE: the basemap variant swaps at once (a diffed `setStyle`, `swapBasemap` —
   * operator Q1 = B), then the fog's uniforms and the route glow cross-fade over 320 ms on one
   * eased curve. Under reduced motion the fade is a hard cut (`06` §4.3 #3).
   *
   * THE CAMERA IS NOT TOUCHED. No `jumpTo`, no `easeTo`; the style carries no centre or zoom, and
   * MapLibre's diff skips camera commands even if it did. `tools/fog-harness/run-mode-swap.mjs`
   * measures it on a real Map.
   *
   * A re-toggle mid-fade starts from the frame on screen, so nothing jumps back to an end state.
   */
  useEffect(() => {
    if (!loaded) return
    const to = wanted
    if (shown.current === to) {
      setFogAnimated(MODE_FRAMES[to].fog.animated)
      return
    }
    shown.current = to
    try {
      swapBasemap(loaded as never, to)
    } catch (error) {
      log.warn(`map mode: the basemap swap to ${to} failed: ${(error as Error).message}`)
    }
    transition.current?.cancel()
    if (MODE_FRAMES[to].fog.animated) setFogAnimated(true)
    transition.current = startModeTransition({
      from: frame.current,
      to: MODE_FRAMES[to],
      reduced: prefersReducedMotion(),
      ms: fadeMsRef.current,
      clock: {
        now: () => performance.now(),
        requestAnimationFrame: (cb) => window.requestAnimationFrame(cb),
        cancelAnimationFrame: (h) => window.cancelAnimationFrame(h),
      },
      apply: (next) => {
        frame.current = next
        applyModeFrame(loaded, fogLayerRef.current, next)
      },
      done: () => setFogAnimated(MODE_FRAMES[to].fog.animated),
    })
  }, [loaded, wanted])

  useEffect(() => () => transition.current?.cancel(), [])

  /** `0098`. A fog layer created mid-session takes the frame on screen (it was built from it too). */
  useEffect(() => {
    fogLayer?.setPalette(frame.current.fog)
  }, [fogLayer])

  /** `0080`. Reported after commit, so the layer handed over has had its reveal installed. */
  useEffect(() => {
    onStage?.(
      unsupported
        ? { kind: "unsupported" }
        : lost
          ? { kind: "lost" }
          : loaded
            ? { kind: "ready", map: loaded, layer: fogLayer }
            : null,
    )
  }, [onStage, unsupported, lost, loaded, fogLayer])

  /**
   * Ticket `0057`. The route above the fog, and the optimistic corridor inside the mask.
   *
   * **CALLED AFTER `useFogMask`, AND THE ORDER IS LOAD-BEARING.** Effects run in declaration
   * order within a commit, and `setBucket` discards the optimistic corridor by design — so the
   * bucket must be handed over before the corridor is. Swapping these two lines wipes the
   * corridor on the frame it is set, on some commits and not others. `use-latest-run.ts` says
   * the same thing at the effect that depends on it.
   */
  const { runs, answer } = useLatestRun(loaded, fogLayer, run, held === null)

  /**
   * `0086`. Handed up after commit; a run's page (`framed`) has nothing to report. `0273`: with what
   * the answer speaks for, in the same call, so home never pairs a new run with an old answer.
   */
  useEffect(() => {
    if (!framed) onLatestRun?.(runs, answer)
  }, [framed, onLatestRun, runs, answer])

  /**
   * `0098`. The route's glow, in the mode on screen. The route layers are added with §4.4's 0.35
   * (`useLatestRun`, just above, in an earlier effect of the same commit); atlas draws the core alone.
   */
  useEffect(() => {
    if (loaded) applyModeFrame(loaded, fogLayerRef.current, frame.current)
  }, [loaded, runs])

  /**
   * Ticket `0085`. Every past route, faint, under the labels (`lib/trace-web/layer.ts`). `0101`: on a
   * run's page it dims beneath the selected run, so a path run once reads 0.18 (`06` §4.5).
   */
  useTraceWeb(loaded, framed ? RUN_PAGE_TRACE_K : 1)

  /**
   * `0101`. THE SELECTED RUN ON `/`: the latest, unless a click on one route line picked another
   * (`MapControls`, `06` §4.5). Declared after `useLatestRun`, so on a commit that carries both, this
   * effect writes last and the inspected run stays drawn; dismissing it gives the line back.
   */
  const [inspected, setInspected] = useState<IndexedRun | null>(null)
  useEffect(() => {
    if (!loaded || framed) return
    try {
      const source = loaded.getSource(RUN_SOURCE_ID) as { setData?: (d: unknown) => void } | undefined
      source?.setData?.(inspected ? selectedCollection(inspected) : runs)
      loaded.triggerRepaint()
    } catch (error) {
      log.warn(`map: could not draw the selected run: ${(error as Error).message}`)
    }
  }, [loaded, framed, runs, inspected])

  /**
   * Ticket `0260`. Every recorded cairn and shrine, above the fog and under the route. Home only: a
   * run's page is about that run, and its sequence drives the map imperatively.
   */
  useLandmarks(framed ? null : loaded)

  /**
   * Ticket `0186`. THE MOST RECENT RUN'S CENTRE, ON A FIRST-EVER LOAD ONLY.
   *
   * The run comes from `useLatestRun`'s fetch and from nowhere else — the ticket forbids a second
   * query path, and it is also the privacy answer: `/api/runs/latest` is session-gated, so the
   * coordinate never enters the server-rendered payload of `/`, which a signed-out visitor can
   * fetch (`lib/map-home.ts`). A server-side read would have put it there, behind the same gate,
   * at the cost of a DynamoDB query and an S3 read on every render of `/` to serve a default that
   * the stored camera overrides on every load but the first.
   *
   * `jumpTo`, not `flyTo`: this is the map's starting position arriving a moment late, not a
   * navigation. The `moveend` it fires writes it to storage, so the next load opens here directly.
   */
  /**
   * Ticket `0074`. `/?at=<lng>,<lat>` — the skill sheet's `→ fly to`. A `flyTo`, unlike the run
   * centring below, because this IS a navigation: the operator asked to be taken somewhere, and
   * the flight is what says where it is relative to where they were.
   *
   * It outranks the run centring (an explicit request beats a default), so it marks the camera as
   * already centred. The parameter is then dropped from the address bar, so a reload opens on
   * the stored camera — which the flight's `moveend` has just written — rather than flying again.
   */
  useEffect(() => {
    if (!loaded || framed) return
    const at = parseAt(window.location.search)
    if (!at) return
    centredOnRun.current = true
    loaded.flyTo({ center: [at.lng, at.lat], zoom: at.zoom, bearing: 0 })
    const url = new URL(window.location.href)
    url.searchParams.delete("at")
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash)
  }, [loaded, framed])

  useEffect(() => {
    if (!loaded || framed) return
    const target = firstLoadRunCamera({
      storedAtMount: storedAtMount.current,
      userMoved: userMoved.current,
      alreadyCentred: centredOnRun.current,
      runs,
    })
    if (!target) return
    centredOnRun.current = true
    loaded.jumpTo({ center: [target.lng, target.lat], zoom: target.zoom, bearing: 0 })
  }, [loaded, runs, framed])

  if (unsupported) {
    return (
      <div style={framed ? framedShell : paneClassName ? undefined : shell} className={framed ? undefined : paneClassName}>
        <p style={notice}>
          This device cannot run the map. Lost Soles needs WebGL2, which this browser does
          not support.
        </p>
      </div>
    )
  }

  return (
    <>
      {/*
        Ticket 0285. Home only: the jump-to control, under `⚙`. Before the map in the DOM, so the
        focus order is `⚙` → jump-to → the map (§2.2). A jump marks the camera as placed, so the
        first-load run centring cannot land on top of it if the latest run arrives after.
      */}
      {framed ? null : (
        <RegionJump
          map={loaded}
          onJump={() => {
            centredOnRun.current = true
          }}
        />
      )}
      {/* Ticket 0101. Home only: fit-to-territory and `⌖` on the pane, and inspecting a run by clicking its line. */}
      {framed ? null : <MapControls map={loaded} latest={runs} onSelect={setInspected} />}
      <div
        ref={container}
        style={framed ? framedShell : paneClassName ? undefined : shell}
        className={framed ? undefined : paneClassName}
        data-testid="map-shell"
      />
      {/*
        Ticket 0055, criterion 10. Renders only under `?fog=mask`, and it is what makes an EMPTY
        mask distinguishable from a broken one — see mask-hud.tsx. It also carries the zoom, which
        this ticket's operator validation names and the UI otherwise never shows.
      */}
      <MaskHud map={loaded} layer={fogLayer} />
      {/* Ticket 0059. Renders only under `?fog=perf`; `harness` is null otherwise. */}
      <PerfOverlay map={loaded} layer={fogLayer} harness={harness} />
      {/* Ticket 0079. Renders only under `?fog=scrub`, on a run's page. */}
      {reveal ? <RevealScrub layer={fogLayer} cells={reveal.length} /> : null}
    </>
  )
}

export default MapShell
