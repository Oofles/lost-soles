"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { useExplored } from "@/components/map/explored-provider"
import type { MapStage } from "@/components/map/map-shell"
import { fogDisabled, perfEnabled } from "@/lib/fog/debug-flags"
import { FogPerf, type FrameStats } from "@/lib/fog/perf/collector"
import { runBounds } from "@/lib/map-camera"
import { log } from "@/lib/log"
import { documentRoutePalette } from "@/lib/map-layers"
import { beat1At } from "@/lib/run-moment/beat1"
import { flyToRun } from "@/lib/run-moment/camera"
import { installInk, type Ink } from "@/lib/run-moment/ink"
import { lanternPath } from "@/lib/run-moment/lantern-path"
import { modeCrossFade, savedRenderMode } from "@/lib/run-moment/mode"
import { documentBloomPalette } from "@/lib/run-moment/palette"
import type { RunSummary } from "@/lib/runs/wire"

/**
 * THE SEQUENCE'S SEAT. Ticket `0078` laid it out; `0080` fills beat 1. `06-ui-ux.md` §3.2.
 *
 * Mounted over the end state by an autoplay entry or `⟲ Relive`, unmounted by `onDone`. Whatever
 * plays here ends by calling `onDone`, and the end state is already underneath — the contract every
 * beat ticket inherits. Beat 1 is the only beat so far, so it is the one that calls it, at 2.9 s.
 *
 * ─── BEAT 1: THE MAP, FIRST, ALWAYS ─────────────────────────────────────────
 *
 * Everything time-shaped is `lib/run-moment/beat1.ts`, which is pure; this component is the wiring.
 * Per frame it moves ONE number — the lantern's arc — into four places: the mask's `revealProgress`
 * (so the fog burns back exactly where the light is, criterion 4), the bloom clock, the ink's head,
 * and the lantern's screen position. All four imperatively: a value that changes sixty times a second
 * is never React state, and the map shell never re-renders during the beat.
 *
 * ─── t = 0 IS WHEN THE MAP CAN SHOW IT, NOT WHEN THE ROUTE MOUNTED ──────────
 *
 * The clock does not start until the map has loaded, the fog layer holds this run's reveal (installed
 * at progress 0 by `useFogMask`), and the explored set has arrived. Starting earlier would play the
 * reveal over a map that is not yet there — or over a stand-in empty set, where the run's familiar
 * ground is fogged and then pops clear mid-beat. Until then nothing renders over the map: no spinner,
 * no toast, no title (§3.2, criterion 7), and the run's own line is held hidden so it cannot give the
 * route away before the lantern draws it.
 *
 * Two ways out without playing, both to the end state: no WebGL2 (`MapShell` reports `unsupported`)
 * and no route to walk (an untraced activity). And a `GIVE_UP_MS` ceiling on the wait, because a beat
 * that never starts must not hold the page — the end state is the canonical view (§3.3).
 *
 * Skip, reduced motion and WebGL loss mid-beat are `0084`'s.
 */

/** How long to wait for the map before giving up and showing the end state. */
const GIVE_UP_MS = 8000

/** The lantern's soft radius, CSS px. §3.2: *"18dp soft radius"*. */
const LANTERN_R = 18

declare global {
  interface Window {
    /** `?fog=perf` only — beat 1's measured wall-clock length and frame stats, for the harness. */
    __beat1?: { ms: number; frames: FrameStats | null }
  }
}

export function RunSequence({
  summary,
  stage = null,
  onDone,
}: {
  summary: RunSummary
  stage?: MapStage
  onDone: () => void
}) {
  const path = useMemo(() => lanternPath(summary.route.features[0]?.geometry), [summary])
  const expectReveal = summary.reveal.new.length + summary.reveal.rearmed.length > 0

  const explored = useExplored()
  const exploredReady = useRef(false)
  exploredReady.current = explored.phase !== "loading"

  const lantern = useRef<HTMLDivElement | null>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (stage?.kind === "unsupported" || !path) {
      onDone()
      return
    }
    if (stage?.kind !== "ready") return
    const { map, layer } = stage
    const fogOff = fogDisabled(window.location.search)
    setHost(map.getContainer())

    let ink: Ink | null = null
    try {
      ink = installInk(map, path, documentRoutePalette())
    } catch {
      // No route palette (the stylesheet did not load): the beat plays with no ink rather than not
      // at all. `use-latest-run` makes the same trade for the steady-state line.
    }
    const bloomPalette = documentBloomPalette()
    const perf = perfEnabled(window.location.search) ? new FogPerf() : null

    const ready = () =>
      exploredReady.current && (fogOff || (layer !== null && (!expectReveal || layer.stats().reveal !== null)))

    let raf = 0
    const mounted = performance.now()
    let t0: number | null = null
    let finished = false

    const startCamera = () => {
      const box = runBounds(summary.route)
      if (box) flyToRun(map, box)
    }

    const finish = (now: number) => {
      if (finished) return
      finished = true
      if (perf && t0 !== null) {
        const frames = perf.snapshot().frames.find((f) => f.phase === "beat1") ?? null
        window.__beat1 = { ms: now - t0, frames }
        // One line, so the reading is on screen in devtools for whoever is watching the beat.
        log.info(
          `beat 1: ${(now - t0).toFixed(0)} ms` +
            (frames
              ? ` · p50 ${frames.p50.toFixed(2)} ms · ${frames.dropped}/${frames.samples} dropped (${frames.droppedPct.toFixed(1)}%) · ~${frames.displayHz} Hz`
              : ""),
        )
      }
      // §3.2's cross-fade back to the saved mode. Always `null` until capability 15 adds the setting
      // (`lib/run-moment/mode.ts`, D-295): the beat already renders in the only mode there is.
      void modeCrossFade(savedRenderMode())
      onDone()
    }

    const tick = (now: number) => {
      if (t0 === null) {
        ink?.hold()
        if (!ready()) {
          if (now - mounted > GIVE_UP_MS) return finish(now)
          raf = requestAnimationFrame(tick)
          return
        }
        t0 = now
        perf?.beginPhase("beat1")
        startCamera()
      }
      perf?.frame(now)

      const f = beat1At(now - t0)
      layer?.setRevealProgress(f.progress)
      layer?.setBloom(bloomPalette ? f.bloom : null, bloomPalette ?? undefined)
      ink?.update(f.progress)

      const el = lantern.current
      if (el) {
        const p = map.project(path.at(f.progress))
        const scale = 1 + 0.8 * f.pulse
        el.style.transform = `translate(${p.x - LANTERN_R}px, ${p.y - LANTERN_R}px) scale(${scale})`
        el.style.opacity = String(f.lantern)
      }
      map.triggerRepaint()

      if (f.phase === "done") return finish(now)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      ink?.remove()
      layer?.setBloom(null)
      setHost(null)
    }
  }, [stage, path, expectReveal, summary, onDone])

  if (!host) return null
  // The lantern: a point of warm light, additive (`plus-lighter`), riding the map's own container so
  // it scrolls with the map and never with the page. `pointer-events: none` — it is light, not UI.
  return createPortal(
    <div
      ref={lantern}
      aria-hidden="true"
      data-testid="lantern"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: LANTERN_R * 2,
        height: LANTERN_R * 2,
        borderRadius: "50%",
        background:
          "radial-gradient(circle, var(--route-core) 0%, var(--lantern-500) 30%, transparent 100%)",
        mixBlendMode: "plus-lighter",
        pointerEvents: "none",
        opacity: 0,
        zIndex: 1,
        willChange: "transform, opacity",
      }}
    />,
    host,
  )
}
