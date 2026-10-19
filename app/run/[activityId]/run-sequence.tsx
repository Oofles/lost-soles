"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { useExplored } from "@/components/map/explored-provider"
import type { MapStage } from "@/components/map/map-shell"
import { fogDisabled, perfEnabled } from "@/lib/fog/debug-flags"
import { FogPerf, type FrameStats } from "@/lib/fog/perf/collector"
import { runBounds } from "@/lib/map-camera"
import { log } from "@/lib/log"
import { documentRoutePalette } from "@/lib/map-layers"
import { BEAT1_MS, beat1At, beat1ReducedAt } from "@/lib/run-moment/beat1"
import { LevelUpQueue, type FlyTarget } from "@/components/level-up-card"
import { skillCards, totalCards, type LevelCard } from "@/lib/level-up/cards"
import { BEAT4_START, BEAT5_START, beat45At, SEQUENCE_END } from "@/lib/run-moment/beat45"
import { beat2At, beat2ReducedAt, BEAT2_MS, COUNT_MS, easeOutQuint, FADE_MS, lineStart, PausableClock, PULL_BACK_ZOOM, RISE_MS, type Beat2Frame } from "@/lib/run-moment/beat2"
import { cardTriggers, type CardTrigger } from "@/lib/run-moment/tally"
import { flyToRun, pullBack } from "@/lib/run-moment/camera"
import { installInk, installTraceInk, type Ink, type TraceInk } from "@/lib/run-moment/ink"
import { lanternPath } from "@/lib/run-moment/lantern-path"
import { documentBloomPalette } from "@/lib/run-moment/palette"
import type { RunSummary } from "@/lib/runs/wire"
import { documentTraceColor, installWebBeat, type WebBeat } from "@/lib/trace-web/layer"
import { webRuns } from "@/lib/trace-web/runs"
import { buildWeb, type WebRunInput } from "@/lib/trace-web/web"

import { tallyFooters, tallyLineCount, TallyView, type useRunTally } from "./run-ledger"
import { ChronicleLine } from "./run-lines"

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
 * ─── NO NEW GROUND: THE LINE JOINS THE WEB (`0085`) ─────────────────────────
 *
 * §3.5 rule 2. A run that reveals nothing keeps all 2.9 s — the clock below does not know what the
 * run revealed — and changes subject: the ink is the permanent trace layer's (`installTraceInk`),
 * not the route's amber, so what draws behind the lantern is the record of the passage. On every
 * traced run the web is shown as it was WITHOUT this run until the lantern lands, then cross-fades
 * to the web with it over the settle (`installWebBeat`), so the segments run most visibly darken.
 *
 * ─── SKIP, REDUCED MOTION, WEBGL LOSS (`0084`) ──────────────────────────────
 *
 * Skip is NOT here, by design: one set of listeners in `RunMoment` (`lib/run-moment/exit.ts`) ends the
 * sequence by unmounting this whole tree, which cancels every beat's clock in its cleanup. No beat
 * knows it can be skipped, so no beat can skip to the next one. WebGL loss is `RunMoment`'s too.
 *
 * `reduced` (`prefers-reduced-motion`, read once per play) swaps each beat's frame function for its
 * motionless twin — `beat1ReducedAt`, `beat2ReducedAt`, `cardReducedAt` — and drops the camera moves.
 * Same clocks, same boundaries, same content: §3.4 removes only the motion, never the order.
 *
 * ─── BEAT 2: THE TALLY, LAID ON THE MAP (`0081`) ────────────────────────────
 *
 * Beat 1 no longer calls `onDone`; it hands to `Beat2`, which owns its own clock (`beat2.ts`) and
 * calls `onDone` at 6.0 s. The reveal, the ink and the lit map stay exactly as beat 1 left them — the
 * effect's cleanup only runs when the whole sequence unmounts. Beat 2 plays even when beat 1 could
 * not (an untraced activity, no WebGL2): the tally is the numbers, and §3.4 says the numbers never
 * depend on the graphics.
 *
 * ─── BEATS 4 AND 5: THE TWO LINES, ON THE SAME PANEL (`0083`) ───────────────
 *
 * Beat 2's clock runs on past 6.0 s instead of ending there: the chronicle line fades in under the
 * settled tally at 6.0 s, the frontier line under it at 7.2 s, and `onDone` comes at 8.4 s
 * (`beat45.ts`). One clock, so a pause anywhere in beat 2 moves every later boundary with it. While
 * the chronicle line is fading nothing else moves: the tally's frame is held at its settled value.
 */

/** How long to wait for the map before giving up and showing the end state. */
const GIVE_UP_MS = 8000

/** The lantern's soft radius, CSS px. §3.2: *"18dp soft radius"*. */
const LANTERN_R = 18

declare global {
  interface Window {
    /** `?fog=perf` only — beat 1's measured wall-clock length and frame stats, for the harness. */
    __beat1?: { ms: number; frames: FrameStats | null }
    /**
     * `0081`. The sequence's beat boundaries, `performance.now()` ms, for the smoke harness: when the
     * sequence clock started (beat 1's t=0), when beat 2 began and ended, and how long it sat paused.
     */
    __sequence?: {
      t0: number | null
      beat2Start?: number
      beat2End?: number
      /** `0083`. Beats 4 and 5's starts, and the sequence's end, `performance.now()` ms. */
      beat4Start?: number
      beat5Start?: number
      end?: number
      pausedMs?: number
    }
  }
}

export function RunSequence({
  summary,
  stage = null,
  tally,
  chronicle,
  frontier,
  onLines,
  onDone,
  reduced = false,
}: {
  summary: RunSummary
  stage?: MapStage
  tally: ReturnType<typeof useRunTally>
  /** Beat 4's sentence (`0083`). */
  chronicle: string
  /** Beat 5's line at a given opacity (`0083`). */
  frontier: (opacity: number) => ReactNode
  /** Called once, when beat 4 begins — the frontier is computed then, off beat 1 and 2's frames. */
  onLines: () => void
  onDone: () => void
  /** `0084`. `prefers-reduced-motion`, read once when the sequence began. */
  reduced?: boolean
}) {
  // The `performance.now()` at which beat 2 begins — beat 1's NOMINAL end, not whenever React got
  // round to mounting beat 2. Measured in 0081's smoke: starting the clock at mount put beat 2 ~100 ms
  // late (a state update, a render and an effect, at SwiftShader frame rates).
  const [handoff, setHandoff] = useState<number | null>(null)
  const toBeat2 = useCallback((at: number) => setHandoff((h) => h ?? at), [])
  const beat1 = <Beat1 summary={summary} stage={stage} onDone={toBeat2} reduced={reduced} />
  return (
    <>
      {beat1}
      {handoff !== null ? (
        <Beat2
          summary={summary}
          stage={stage}
          data={tally}
          handoff={handoff}
          chronicle={chronicle}
          frontier={frontier}
          onLines={onLines}
          onDone={onDone}
          reduced={reduced}
        />
      ) : null}
    </>
  )
}

function Beat1({
  summary,
  stage,
  onDone,
  reduced,
}: {
  summary: RunSummary
  stage: MapStage
  /** Called once, with the `performance.now()` at which beat 1 ended. */
  onDone: (at: number) => void
  reduced: boolean
}) {
  const path = useMemo(() => lanternPath(summary.route.features[0]?.geometry), [summary])
  const expectReveal = summary.reveal.new.length + summary.reveal.rearmed.length > 0

  // `0085`. The web's inputs: the array, `"none"` when the fetch failed (the beat plays without
  // the web), or `null` while it is in flight.
  const web = useRef<WebRunInput[] | "none" | null>(null)

  const explored = useExplored()
  const exploredReady = useRef(false)
  exploredReady.current = explored.phase !== "loading"

  const generation = explored.generation
  useEffect(() => {
    let cancelled = false
    webRuns(generation).then(
      (runs) => {
        if (!cancelled && web.current === null) web.current = runs
      },
      () => {
        if (!cancelled && web.current === null) web.current = "none"
      },
    )
    return () => {
      cancelled = true
    }
  }, [generation])

  const lantern = useRef<HTMLDivElement | null>(null)
  const ended = useRef(false)
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    // Beat 1 plays once. It stays mounted through beat 2 (its ink and reveal ARE beat 2's lit map),
    // so a late stage change must not start it again.
    if (ended.current) return
    if (stage?.kind === "unsupported" || !path) {
      ended.current = true
      onDone(performance.now())
      return
    }
    if (stage?.kind !== "ready") return
    const { map, layer } = stage
    const fogOff = fogDisabled(window.location.search)
    setHost(map.getContainer())

    let ink: Ink | null = null
    let traceInk: TraceInk | null = null
    let traceColor: string | null = null
    try {
      traceColor = documentTraceColor()
    } catch {
      // No trace token: the beat plays with no web, and with the route's ink on every run.
    }
    try {
      if (!expectReveal && traceColor) ink = traceInk = installTraceInk(map, path, traceColor)
      else ink = installInk(map, path, documentRoutePalette())
    } catch {
      // No route palette (the stylesheet did not load): the beat plays with no ink rather than not
      // at all. `use-latest-run` makes the same trade for the steady-state line.
    }
    let webBeat: WebBeat | null = null
    const installWeb = () => {
      const runs = web.current
      if (webBeat || !traceColor || runs === null || runs === "none") return
      webBeat = installWebBeat(map, buildWeb(runs, { exclude: summary.activityId }), traceColor)
      webBeat.crossfade(0)
    }
    const bloomPalette = documentBloomPalette()
    const perf = perfEnabled(window.location.search) ? new FogPerf() : null

    const ready = () =>
      exploredReady.current &&
      web.current !== null &&
      (fogOff || (layer !== null && (!expectReveal || layer.stats().reveal !== null)))

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
      ended.current = true
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
      // §3.2's cross-fade back to the saved mode is `MapShell`'s (`0098`): the run page hands it
      // `runPageMode`, which leaves adventure when the sequence's phase ends, and `runPageFadeMs`
      // (`0254`): 320 ms after a finish like this one, none after a skip.
      onDone(t0 !== null && now - t0 >= BEAT1_MS ? t0 + BEAT1_MS : now)
    }

    const tick = (now: number) => {
      // As soon as the web is here — before t0 too, so the map never shows this run in it early.
      installWeb()
      if (t0 === null) {
        ink?.hold()
        webBeat?.crossfade(0)
        if (!ready()) {
          if (now - mounted > GIVE_UP_MS) return finish(now)
          raf = requestAnimationFrame(tick)
          return
        }
        t0 = now
        window.__sequence = { t0 }
        perf?.beginPhase("beat1")
        // Reduced motion: no flight. The map was framed on the run at mount (`MapShell`).
        if (!reduced) startCamera()
      }
      perf?.frame(now)

      const f = reduced ? beat1ReducedAt(now - t0) : beat1At(now - t0)
      layer?.setRevealProgress(f.progress)
      layer?.setBloom(bloomPalette && !reduced ? f.bloom : null, bloomPalette ?? undefined)
      // Reduced: the whole line at once — its head travelling IS the lantern traversal.
      ink?.update(reduced ? 1 : f.progress)
      // The line settles into the web as the lantern goes out.
      traceInk?.fade(1 - f.web)
      webBeat?.crossfade(f.web)

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
      webBeat?.remove()
      layer?.setBloom(null)
      setHost(null)
    }
  }, [stage, path, expectReveal, summary, onDone, reduced])

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

/** How long beat 2 waits for the ledger read before giving up and showing the end state. */
const TALLY_GIVE_UP_MS = 4000

/**
 * BEAT 2. Ticket `0081`. The camera pulls back, the parchment rises over the bottom ~55% of the
 * viewport, and the tally counts in (`beat2.ts`). The panel is laid ON the map — fixed to the
 * viewport, never a full-screen takeover — and opaque (D-148: floating chrome is never translucent).
 *
 * Clicking a row expands its reason breakdown and PAUSES the beat's clock; collapsing every row
 * resumes it where it stopped (criterion 8). The clock is a value read each frame, never React state;
 * only the frame it produces is.
 */
function Beat2({
  summary,
  stage,
  data,
  handoff,
  chronicle,
  frontier,
  onLines,
  onDone,
  reduced,
}: {
  summary: RunSummary
  stage: MapStage
  data: ReturnType<typeof useRunTally>
  /** Beat 2's t = 0, when the ledger is already here. */
  handoff: number
  chronicle: string
  frontier: (opacity: number) => ReactNode
  onLines: () => void
  onDone: () => void
  reduced: boolean
}) {
  const count = data.tally ? tallyLineCount(data.tally, summary) : 0
  const frameAt = reduced ? beat2ReducedAt : beat2At
  const [frame, setFrame] = useState<Beat2Frame>(() => frameAt(0, count))
  const [lines, setLines] = useState(() => beat45At(0))
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [started, setStarted] = useState(false)
  const clock = useRef<PausableClock | null>(null)
  const countRef = useRef(count)
  countRef.current = count

  /**
   * BEAT 3'S INTERRUPTIONS (`0082`). Built once the tally is here: each skill line that crossed a
   * level hands its cards over when its count lands, and Total Level milestones play after the Total
   * Level line. While cards play, beat 2's clock is stopped — the tally resumes where it left off.
   */
  const triggers = useMemo<CardTrigger<LevelCard>[]>(() => {
    const t = data.tally
    if (!t) return []
    const footers = tallyFooters(t, summary)
    const n = t.lines.length + footers.length
    const levelIdx = footers.indexOf("level")
    const gained = Object.fromEntries(t.lines.map((l) => [l.skillId, l.xp]))
    return cardTriggers(
      t,
      { lineStart: (i) => lineStart(i, n), countMs: COUNT_MS, fadeMs: FADE_MS },
      (line) => skillCards(line.skillId, line.standing!.xpBefore, line.xp, data.rules.curve),
      levelIdx >= 0 ? t.lines.length + levelIdx : null,
      () => (data.xpBefore ? totalCards(data.xpBefore, gained, data.rules) : []),
    )
  }, [data.tally, data.rules, data.xpBefore, summary])
  const triggersRef = useRef(triggers)
  triggersRef.current = triggers
  const nextTrigger = useRef(0)
  const [playing, setPlaying] = useState<LevelCard[] | null>(null)
  const [pulse, setPulse] = useState<{ x: number; y: number; key: number } | null>(null)

  // Where a place-bound card flies: the route, walked by the card's share of the run's XP (D-297).
  const path = useMemo(() => lanternPath(summary.route.features[0]?.geometry), [summary])
  const flyTo: FlyTarget = (card) => {
    if (stage?.kind !== "ready" || !path) return null
    const p = stage.map.project(path.at(card.arc))
    const r = stage.map.getContainer().getBoundingClientRect()
    return { x: r.left + p.x, y: r.top + p.y }
  }

  // Nothing to tally, or the read failed: beat 2 has nothing to show, so the end state comes now.
  const nothing = data.error !== undefined || (data.tally !== undefined && count === 0)
  useEffect(() => {
    if (nothing) onDone()
  }, [nothing, onDone])

  // The ledger normally arrived during beat 1. If it has not, wait — briefly — rather than count up
  // an empty panel.
  useEffect(() => {
    if (data.tally || nothing) return
    const id = setTimeout(onDone, TALLY_GIVE_UP_MS)
    return () => clearTimeout(id)
  }, [data.tally, nothing, onDone])

  const ready = data.tally !== undefined && count > 0
  const readyAtHandoff = useRef(ready)
  useEffect(() => {
    if (!ready) return
    // A tally that was waited for starts when it arrived, not back-dated into the wait.
    const start = readyAtHandoff.current ? handoff : performance.now()
    const c = new PausableClock(start)
    clock.current = c
    const seq = (window.__sequence ??= { t0: null })
    seq.beat2Start = start
    setStarted(true)

    // §3.2: pull back 1.5 zoom levels from the run's own framing, over the parchment's 300 ms rise,
    // shifted up by half the part of the map the panel covers so the run's ground stays in view.
    const box = runBounds(summary.route)
    if (stage?.kind === "ready" && box) {
      const rect = stage.map.getContainer().getBoundingClientRect()
      const covered = Math.max(0, Math.min(rect.bottom, window.innerHeight) - window.innerHeight * 0.45)
      // Reduced motion: the same framing, arrived at in one frame.
      pullBack(stage.map, box, { zoomOut: PULL_BACK_ZOOM, covered, duration: reduced ? 0 : RISE_MS, easing: easeOutQuint })
    }

    let raf = 0
    const tick = (now: number) => {
      if (!c.isPaused) {
        let t = c.elapsed(now)
        const due = triggersRef.current[nextTrigger.current]
        if (due && t >= due.at) {
          // Hand off at exactly the trigger's instant: the bar is full and holds under the card.
          t = due.at
          nextTrigger.current++
          c.pause(now)
          c.rewindTo(due.at, now)
          setPlaying(due.cards)
        }
        // Held at the settled tally once beat 2 is over: nothing but the lines moves in beats 4–5.
        setFrame(frameAt(Math.min(t, BEAT2_MS), countRef.current))
        setLines(beat45At(t))
        if (t >= BEAT4_START && seq.beat4Start === undefined) {
          seq.beat2End = seq.beat4Start = now
          onLines()
          if (perfEnabled(window.location.search)) {
            log.info(`beat 2: ${(now - start).toFixed(0)} ms wall, ${c.pausedMs(now).toFixed(0)} ms paused`)
          }
        }
        if (t >= BEAT5_START && seq.beat5Start === undefined) seq.beat5Start = now
        if (t >= SEQUENCE_END) {
          seq.end = now
          seq.pausedMs = c.pausedMs(now)
          onDone()
          return
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // `stage` is read once, at the beat's start: the camera move is a one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, onDone])

  // Expansion pauses the sequence, and so does a card; the clock runs again only when neither holds it.
  useEffect(() => {
    const c = clock.current
    if (!c) return
    if (expanded.size > 0 || playing) c.pause(performance.now())
    else c.resume(performance.now())
  }, [expanded, playing])

  const onToggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  if (!started) return null
  return (
    <>
    {playing ? (
      <LevelUpQueue
        cards={playing}
        skillName={data.skillName}
        flyTo={flyTo}
        onPlaced={(at) => setPulse({ ...at, key: performance.now() })}
        onDone={() => setPlaying(null)}
        reduced={reduced}
      />
    ) : null}
    {pulse ? <CellPulse key={pulse.key} x={pulse.x} y={pulse.y} onEnd={() => setPulse(null)} /> : null}
    <div
      data-testid="tally-panel"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: "55vh",
        overflowY: "auto",
        background: "var(--surface)",
        borderTop: "2px solid var(--gold-500)",
        boxShadow: "0 -8px 24px rgb(0 0 0 / 0.18)",
        // Reduced motion: `rise` is the panel's fade, not its travel (`beat2ReducedAt`).
        ...(reduced ? { opacity: frame.rise } : { transform: `translateY(${((1 - frame.rise) * 100).toFixed(2)}%)` }),
        zIndex: 10,
      }}
    >
      <div style={{ maxWidth: "40rem", margin: "0 auto", padding: "1rem 1rem 1.5rem" }}>
        <TallyView
          summary={summary}
          tally={data.tally}
          skillName={data.skillName}
          frame={frame}
          expanded={expanded}
          onToggle={onToggle}
        />
        {lines.phase !== "before" ? <ChronicleLine text={chronicle} opacity={lines.chronicle} /> : null}
        {lines.phase === "frontier" || lines.phase === "done" ? frontier(lines.frontier) : null}
      </div>
    </div>
    </>
  )
}

/**
 * THE EARNING CELL PULSES ONCE (§3.2, `0082`) where a place-bound card landed. A ring of the
 * route's light, 700 ms, then gone. `0248` records the landmark at this same arc (D-301); drawing
 * it on the map for good is `0260`.
 */
const PULSE_MS = 700
function CellPulse({ x, y, onEnd }: { x: number; y: number; onEnd: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = ref.current
    const a = el?.animate(
      [
        { transform: "translate(-50%, -50%) scale(0.4)", opacity: 0.9 },
        { transform: "translate(-50%, -50%) scale(1.8)", opacity: 0 },
      ],
      { duration: PULSE_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    )
    const id = setTimeout(onEnd, PULSE_MS)
    return () => (a?.cancel(), clearTimeout(id))
  }, [onEnd])
  return (
    <div
      ref={ref}
      data-testid="cell-pulse"
      aria-hidden="true"
      style={{
        position: "fixed",
        left: x,
        top: y,
        width: 36,
        height: 36,
        borderRadius: "50%",
        border: "3px solid var(--lantern-500)",
        boxShadow: "0 0 18px var(--lantern-500)",
        pointerEvents: "none",
        zIndex: 25,
        transform: "translate(-50%, -50%)",
      }}
    />
  )
}
