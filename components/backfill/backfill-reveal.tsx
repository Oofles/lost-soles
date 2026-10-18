"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { LevelUpQueue } from "@/components/level-up-card"
import type { MapStage } from "@/components/map/map-shell"
import type { BackfillMark } from "@/lib/backfill/batch"
import { aggregateAt, aggregateLedger, aggregateReducedAt, type AggregateFrame, type AggregateLedger } from "@/lib/backfill/reveal"
import { REDUCED_MOTION_QUERY } from "@/lib/fog/animation"
import { fogDisabled } from "@/lib/fog/debug-flags"
import { browserSequenceHistory, wireSequenceExit, type SequenceExit } from "@/lib/run-moment/exit"
import { documentBloomPalette } from "@/lib/run-moment/palette"

/**
 * THE AGGREGATE REVEAL, ON `/`. Ticket `0257`. `06-ui-ux.md` §3.4 *Backfill*.
 *
 * One sequence for a whole historical import, however many activities it brought in: the archive
 * burns back over 4 s, the ledger of lifetime totals and starting levels rises over the map, and ONE
 * card — `Total Level N` — plays. Then the map is simply home again; home IS this sequence's end
 * state, as `/run/:id`'s page is a run's (§3.3).
 *
 * `0084`'s machinery, reused rather than copied:
 *
 *   - **The one exit** (`lib/run-moment/exit.ts`): a click anywhere, Esc, or Back ends it on the
 *     first frame, and so does the sequence finishing. Every way out calls `onDone` exactly once,
 *     and that is where home marks the batch seen on this device. Nothing in here listens for input.
 *   - **Reduced motion**, read once as the sequence mounts: the burn is a 400 ms cross-fade, the
 *     ledger fades rather than rises, the card holds without scaling. Same clock, same content.
 *   - **WebGL loss** aborts to the end state. The ledger is plain DOM and never depended on the map;
 *     `MapShell` rebuilds the map on restore, with the imported ground no longer held back.
 *   - **No WebGL2**: there is no burn to show, so the clock starts at once and the numbers still play.
 */

/** How long to wait for the map and its reveal before starting the clock anyway. */
const GIVE_UP_MS = 8000

export function BackfillRevealSequence({
  mark,
  stage,
  cells,
  onDone,
}: {
  mark: BackfillMark
  stage: MapStage
  /** How many cells burn back. 0: the clock does not wait for a reveal to be installed. */
  cells: number
  onDone: () => void
}) {
  const ledger = useMemo(() => aggregateLedger(mark), [mark])
  const [reduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.(REDUCED_MOTION_QUERY).matches === true,
  )
  const frameAt = reduced ? aggregateReducedAt : aggregateAt
  const [frame, setFrame] = useState<AggregateFrame>(() => frameAt(-1))

  const done = useRef(onDone)
  done.current = onDone

  /** ONE EXIT, for the sequence's whole lifetime. */
  const exit = useRef<SequenceExit | null>(null)
  useEffect(() => {
    const x = wireSequenceExit({ host: window, history: browserSequenceHistory(), onExit: () => done.current() })
    exit.current = x
    return () => {
      x.teardown()
      exit.current = null
    }
  }, [])

  // WebGL lost mid-sequence: abort to the end state (§3.4). The numbers never depended on it.
  useEffect(() => {
    if (stage?.kind === "lost") exit.current?.complete()
  }, [stage])

  const stageRef = useRef(stage)
  stageRef.current = stage

  useEffect(() => {
    const fogOff = fogDisabled(window.location.search)
    const palette = documentBloomPalette()
    const mounted = performance.now()
    let t0: number | null = null
    let raf = 0
    let last: AggregateFrame["phase"] | null = null
    let lastLedger = -1

    const ready = () => {
      const s = stageRef.current
      if (s?.kind === "unsupported") return true
      if (s?.kind !== "ready") return false
      // The fog layer can arrive a commit after the map (home creates it once its hold is known), so
      // a missing layer is "not yet", never "go": starting without it would show the answer first.
      return fogOff || cells === 0 || (s.layer !== null && s.layer.stats().reveal !== null)
    }

    const tick = (now: number) => {
      if (t0 === null) {
        if (!ready() && now - mounted < GIVE_UP_MS) {
          raf = requestAnimationFrame(tick)
          return
        }
        t0 = now
        window.__sequence = { t0 }
      }
      const f = frameAt(now - t0)
      const s = stageRef.current
      if (s?.kind === "ready") {
        s.layer?.setRevealProgress(f.progress)
        s.layer?.setBloom(palette && !reduced ? f.bloom : null, palette ?? undefined)
        s.map.triggerRepaint()
      }
      // React only hears about what it draws: the ledger's fade, and the phase.
      if (f.phase !== last || f.ledger !== lastLedger) setFrame(f)
      last = f.phase
      lastLedger = f.ledger
      if (f.phase === "done") {
        window.__sequence = { ...window.__sequence, t0, end: now }
        exit.current?.complete()
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      const s = stageRef.current
      if (s?.kind === "ready") s.layer?.setBloom(null)
    }
  }, [frameAt, reduced, cells])

  return (
    <>
      {frame.card ? <LevelUpQueue cards={[ledger.card]} skillName={() => ""} onDone={() => {}} reduced={reduced} /> : null}
      {frame.ledger > 0 ? <AggregateLedgerPanel ledger={ledger} opacity={frame.ledger} rise={frame.rise} /> : null}
    </>
  )
}

const label: React.CSSProperties = { color: "var(--text-secondary)", font: "500 13px/1.3 var(--font-sans)" }
const value: React.CSSProperties = {
  color: "var(--text-primary)",
  font: "600 15px/1.3 var(--font-sans)",
  fontVariantNumeric: "tabular-nums",
  textAlign: "right",
}

/**
 * THE LEDGER: lifetime totals and starting levels (§3.4). Laid ON the map like beat 2's panel —
 * fixed, opaque (D-148: floating chrome is never translucent) — and plain DOM, so it survives the
 * graphics failing. Exported for the render test, which draws it with no map at all.
 */
export function AggregateLedgerPanel({ ledger, opacity = 1, rise = 0 }: { ledger: AggregateLedger; opacity?: number; rise?: number }) {
  return (
    <section
      data-testid="backfill-ledger"
      aria-label="Your history"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: "60vh",
        overflowY: "auto",
        background: "var(--surface)",
        borderTop: "2px solid var(--gold-500)",
        boxShadow: "0 -8px 24px rgb(0 0 0 / 0.18)",
        opacity,
        transform: rise ? `translateY(${rise.toFixed(1)}px)` : undefined,
        zIndex: 10,
      }}
    >
      <div style={{ maxWidth: "40rem", margin: "0 auto", padding: "1rem 1rem 1.5rem", display: "grid", gap: ".75rem" }}>
        <header>
          <h2 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "1.25rem", color: "var(--text-primary)" }}>
            Your history
          </h2>
          <p style={{ margin: ".25rem 0 0", ...label }}>{ledger.imported}</p>
        </header>

        <dl aria-label="Lifetime totals" style={{ display: "grid", gridTemplateColumns: "1fr max-content max-content", gap: ".25rem 1rem", margin: 0 }}>
          {ledger.totals.map((t) => (
            <div key={t.label} style={{ display: "contents" }}>
              <dt style={label}>{t.label}</dt>
              <dd style={{ margin: 0, ...value }}>{t.value}</dd>
              <dd style={{ margin: 0, ...label, textAlign: "right" }}>{t.detail ?? ""}</dd>
            </div>
          ))}
        </dl>

        <div>
          <h3 style={{ margin: "0 0 .25rem", ...label, letterSpacing: ".08em" }}>STARTING LEVELS</h3>
          <dl aria-label="Starting levels" style={{ display: "grid", gridTemplateColumns: "1fr max-content max-content", gap: ".25rem 1rem", margin: 0 }}>
            {ledger.skills.map((s) => (
              <div key={s.skillId} style={{ display: "contents" }}>
                <dt style={{ ...label, color: "var(--text-primary)" }}>{s.name}</dt>
                <dd style={{ margin: 0, ...value }}>{s.level}</dd>
                <dd style={{ margin: 0, ...label, textAlign: "right" }}>{s.from !== s.level ? `was ${s.from}` : ""}</dd>
              </div>
            ))}
            <div style={{ display: "contents" }}>
              <dt style={{ ...label, color: "var(--text-primary)", fontWeight: 600, borderTop: "1px solid var(--line)", paddingTop: ".25rem" }}>
                Total Level
              </dt>
              <dd style={{ margin: 0, ...value, borderTop: "1px solid var(--line)", paddingTop: ".25rem" }}>{ledger.totalLevel.to}</dd>
              <dd style={{ margin: 0, ...label, textAlign: "right", borderTop: "1px solid var(--line)", paddingTop: ".25rem" }}>
                {ledger.totalLevel.from !== ledger.totalLevel.to ? `was ${ledger.totalLevel.from}` : ""}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  )
}
