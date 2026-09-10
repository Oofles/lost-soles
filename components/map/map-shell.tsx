"use client"

import { useEffect, useRef, useState } from "react"

import { basemapStyle, registerPmtilesProtocol } from "@/lib/basemap"
import {
  EXTRACT_FALLBACK,
  readCamera,
  writeCamera,
  type Camera,
} from "@/lib/map-camera"

import { useFogMask } from "./use-fog-mask"

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

export function MapShell({ home }: { home: Camera | null }) {
  const container = useRef<HTMLDivElement | null>(null)
  const map = useRef<MapInstance | null>(null)
  const [unsupported, setUnsupported] = useState(false)
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
   * The camera is held in a ref as well as in `localStorage` so that a context-loss
   * rebuild can restore where the operator actually was, not where they were when the
   * last `moveend` fired.
   */
  const camera = useRef<Camera>(home ?? EXTRACT_FALLBACK)

  useEffect(() => {
    if (!hasWebGL2()) {
      setUnsupported(true)
      return
    }

    const stored = readCamera()
    // Stored beats configured home: the ticket wants the FIRST-EVER load centred on home,
    // not every load. After that the operator's own last position is the better answer.
    camera.current = stored ?? home ?? EXTRACT_FALLBACK

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

      const instance = new lib.Map({
        container: container.current,
        style: basemapStyle(),
        center: [camera.current.lng, camera.current.lat],
        zoom: camera.current.zoom,
        bearing: camera.current.bearing,
        /**
         * `Math.min(devicePixelRatio, 2)` — the ticket's cheapest mobile win. A 3x phone
         * gains essentially nothing on a soft mist effect and costs 2.25x the composite
         * fragments once 0056 lands.
         */
        pixelRatio: Math.min(window.devicePixelRatio, 2),
        attributionControl: { compact: false },
      })

      map.current = instance
      // `once`, not `on`: a style change re-fires `load`, and a second setState with the same
      // instance would remount the fog layer for no reason.
      instance.once("load", () => setLoaded(instance))

      instance.on("moveend", () => {
        const centre = instance.getCenter()
        camera.current = {
          lng: centre.lng,
          lat: centre.lat,
          zoom: instance.getZoom(),
          bearing: instance.getBearing(),
        }
        writeCamera(camera.current)
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
    }

    function onRestored() {
      if (disposed || !maplibre) return
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
  }, [home])

  /**
   * Ticket 0055 — pass 1. The hook owns the layer's lifetime and its data; the shell owns the map.
   * Called unconditionally and before the early return below, because hooks are.
   */
  useFogMask(loaded)

  if (unsupported) {
    return (
      <div style={shell}>
        <p style={notice}>
          This device cannot run the map. Lost Soles needs WebGL2, which this browser does
          not support.
        </p>
      </div>
    )
  }

  return <div ref={container} style={shell} data-testid="map-shell" />
}

export default MapShell
