"use client"

import { useEffect, useRef, useState } from "react"

import type { FogMaskLayer } from "@/lib/fog/mask-layer"
import { FogPerf, type FrameStats } from "@/lib/fog/perf/collector"

/**
 * THE REVEAL SCRUB. Ticket `0079`. `?fog=scrub` on `/run/:id`.
 *
 * Drags `revealProgress` from 0 to 1 by hand, over this run's cells. It is how `0079` is validated
 * with none of beat 1 built, and how a renderer regression gets bisected later: if beat 1 looks
 * wrong, the first question is whether the MASK is wrong, and this answers it with the lantern, the
 * clock and the choreography all out of the picture. Combine with `?fog=mask` to scrub the raw
 * coverage instead of the finished fog.
 *
 * `▶ 2.2 s` plays §3.2's traversal once — arc-length parameterised, so any run takes the same
 * time — and reports frame time through `0059`'s own collector, so criterion 6 (*"frame time with a
 * reveal set of 130 cells stays inside the §6.4 budget, measured with the 0059 harness"*) is a
 * reading on screen rather than an assumption. It is a measurement aid, not `0080`'s clock.
 *
 * Progress goes to the layer IMPERATIVELY. The slider's own value is React state because it is
 * this component's to render; the map shell never re-renders on a drag.
 */

const TRAVERSAL_MS = 2200

const panel: React.CSSProperties = {
  position: "fixed",
  bottom: "1rem",
  left: "1rem",
  zIndex: 2,
  display: "grid",
  gap: ".375rem",
  width: "min(22rem, calc(100vw - 2rem))",
  padding: ".5rem .75rem",
  borderRadius: ".375rem",
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--text-secondary)",
  font: "400 .75rem/1.5 ui-monospace, monospace",
}

function frameLine(stats: FrameStats | null): string {
  if (!stats) return "▶ to measure a 2.2 s traversal"
  if (stats.samples === 0) return "no frames"
  return (
    `p50 ${stats.p50.toFixed(2)} ms · ${stats.dropped}/${stats.samples} dropped ` +
    `(${stats.droppedPct.toFixed(1)}%) · ~${stats.displayHz} Hz`
  )
}

export function RevealScrub({ layer, cells }: { layer: FogMaskLayer | null; cells: number }) {
  const [progress, setProgress] = useState(1)
  const [frames, setFrames] = useState<FrameStats | null>(null)
  const [playing, setPlaying] = useState(false)
  const [split, setSplit] = useState<string>("")
  const raf = useRef<number | null>(null)

  useEffect(() => {
    layer?.setRevealProgress(progress)
    const s = layer?.stats().reveal
    if (s) setSplit(`${s.cells} cells · ${s.inBoth} always · ${s.postOnly} in · ${s.preOnly} out`)
  }, [layer, progress])

  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current)
    },
    [],
  )

  const play = () => {
    if (!layer || playing) return
    const perf = new FogPerf()
    perf.beginPhase("reveal")
    setPlaying(true)
    let started: number | null = null
    const step = (now: number) => {
      started ??= now
      perf.frame(now)
      const p = Math.min(1, (now - started) / TRAVERSAL_MS)
      layer.setRevealProgress(p)
      setProgress(p)
      if (p < 1) {
        raf.current = requestAnimationFrame(step)
        return
      }
      raf.current = null
      setPlaying(false)
      setFrames(perf.snapshot().frames.find((f) => f.phase === "reveal") ?? null)
    }
    raf.current = requestAnimationFrame(step)
  }

  return (
    <div style={panel} data-testid="reveal-scrub">
      <div>
        reveal {progress.toFixed(3)} · {split || `${cells} cells`}
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={progress}
        disabled={!layer || playing}
        aria-label="Reveal progress"
        onChange={(e) => setProgress(Number(e.target.value))}
      />
      <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
        <button type="button" onClick={play} disabled={!layer || playing}>
          ▶ 2.2 s
        </button>
        <span>{frameLine(frames)}</span>
      </div>
    </div>
  )
}
