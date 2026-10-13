"use client"

import { useEffect, useRef, useState } from "react"

import { CREST, Mark, sigilPaths } from "@/components/sigil"
import { cardAt, CARD_MS, EXIT_RISE_PX, type CardFrame } from "@/lib/level-up/beat3"
import type { LevelCard } from "@/lib/level-up/cards"

/**
 * BEAT 3 — THE LEVEL-UP CARD, AND ITS QUEUE. Ticket `0082`. `06-ui-ux.md` §3.2 beat 3, §6.4.
 *
 * *"This is the only moment in the app permitted to be loud."* The card takes the screen: the
 * `--scrim` (`--navy-900` at 0.72) over everything, the card on it. One card per level, 1.4 s each,
 * one after another and never overlapping — a triple level-up is 4.2 s and should be (§3.2).
 *
 * The same queue plays over `/run/:id`'s tally and over `/log` (§6.4, *"identically"*). Which cards
 * exist is `lib/level-up/cards.ts`'s, guard included; this file only draws them.
 *
 * TYPE (D-297, amending §3.2's "Cinzel"): §8.4's two families. The skill name is the Title role —
 * Spectral 600, 22sp — uppercase and tracked, which §8.4 allows for uppercase only; the number is the
 * Display role, Spectral 600, 34sp, the one place §8.4 assigns it. Both in `--text-primary` on the
 * card's `--surface`; gold is the border, the rules and the sigil's disc, never the type (D-148).
 */

const SERIF = "Spectral, Georgia, 'Times New Roman', serif"

declare global {
  interface Window {
    /** `0082`. Each played card's `performance.now()` span, for the smoke harness. */
    __cards?: { start: number; end: number; kind: string; to: number }[]
  }
}

/** Where a place-bound card flies, in viewport px; `null` to exit ordinarily. */
export type FlyTarget = (card: Extract<LevelCard, { kind: "skill" }>) => { x: number; y: number } | null

export function LevelUpQueue({
  cards,
  skillName,
  onDone,
  flyTo,
  onPlaced,
}: {
  cards: readonly LevelCard[]
  skillName: (id: string) => string
  onDone: () => void
  flyTo?: FlyTarget
  /** Called as a flown card lands, with where it landed — the run page pulses that cell. */
  onPlaced?: (at: { x: number; y: number }) => void
}) {
  const [index, setIndex] = useState(0)
  const [frame, setFrame] = useState<CardFrame>(() => cardAt(0))
  const target = useRef<{ x: number; y: number } | null>(null)
  const done = useRef(onDone)
  done.current = onDone
  const placed = useRef(onPlaced)
  placed.current = onPlaced

  const card = cards[index]

  useEffect(() => {
    if (!card) {
      done.current()
      return
    }
    target.current = card.kind === "skill" && card.place && flyTo ? flyTo(card) : null
    const start = performance.now()
    const log = (window.__cards ??= [])
    let raf = 0
    const tick = (now: number) => {
      const t = now - start
      setFrame(cardAt(t))
      if (t >= CARD_MS) {
        log.push({ start, end: now, kind: card.kind, to: card.kind === "skill" ? card.to : card.milestone })
        if (target.current) placed.current?.(target.current)
        setIndex((i) => i + 1)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // One run of the clock per card; `flyTo` is read as the card starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card])

  if (!card) return null
  return <LevelUpCard card={card} frame={frame} skillName={skillName} fly={target.current} />
}

export function LevelUpCard({
  card,
  frame,
  skillName,
  fly = null,
}: {
  card: LevelCard
  frame: CardFrame
  skillName: (id: string) => string
  fly?: { x: number; y: number } | null
}) {
  const name = card.kind === "skill" ? skillName(card.skillId) : "Total Level"
  const from = card.kind === "skill" ? card.from : null
  const to = card.kind === "skill" ? card.to : card.milestone
  const paths = card.kind === "skill" ? sigilPaths(card.skillId) : CREST
  const tier = card.kind === "skill" ? card.tier : null
  const place = card.kind === "skill" ? card.place : null

  /**
   * THE EXIT. Ordinarily a fade and a 4 px rise. A place-bound card instead flies into the map —
   * shrinking toward the cell where the level was earned, so the placement is seen as it happens.
   */
  const e = frame.exit
  let transform = `translateY(${-EXIT_RISE_PX * e}px) scale(${frame.scale})`
  if (fly && e > 0 && typeof window !== "undefined") {
    const dx = (fly.x - window.innerWidth / 2) * e
    const dy = (fly.y - window.innerHeight / 2) * e
    transform = `translate(${dx}px, ${dy}px) scale(${frame.scale * (1 - 0.9 * e)})`
  }

  return (
    <div
      data-testid="level-up"
      data-card={card.kind === "skill" ? `${card.skillId}:${card.to}` : `total:${card.milestone}`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 30,
        display: "grid",
        placeItems: "center",
        background: "var(--scrim)",
        opacity: fly ? 1 - e * 0.9 : 1 - e,
      }}
    >
      {/* Announced once, as the card lands — not narrated frame by frame. */}
      <p aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {card.kind === "skill" ? `${name} reached level ${to}.` : `Total Level ${to}.`}
        {tier ? ` ${tier}.` : ""}
      </p>
      <div
        aria-hidden="true"
        style={{
          position: "relative",
          width: "min(22rem, calc(100vw - 2rem))",
          padding: "2rem 1.5rem 1.75rem",
          boxSizing: "border-box",
          background: "var(--surface)",
          color: "var(--text-primary)",
          textAlign: "center",
          transform,
          opacity: fly ? 1 - e : 1,
        }}
      >
        {/* The gold leaf border, wiping in clockwise from the top-left (`pathLength` 1). A rule, D-148. */}
        <svg
          width="100%"
          height="100%"
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}
        >
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="none"
            stroke="var(--gold-500)"
            strokeWidth={3}
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - frame.border}
          />
        </svg>

        {/* The sigil: ink on gold (§3.2) — the disc is a gold FILL, the mark is ink. */}
        <div
          style={{
            width: 72,
            height: 72,
            margin: "0 auto 1rem",
            borderRadius: "50%",
            background: "var(--gold-500)",
            color: "var(--ink-900)",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Mark paths={paths} size={44} />
        </div>

        <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 22, lineHeight: 1.25, letterSpacing: ".12em" }}>
          {name.toUpperCase()}
        </div>

        <div
          style={{
            position: "relative",
            height: 34 * 1.15,
            margin: ".75rem 0 0",
            fontFamily: SERIF,
            fontWeight: 600,
            fontSize: 34,
            lineHeight: 1.15,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {from !== null ? (
            <span data-from style={{ position: "absolute", inset: 0, opacity: frame.oldOpacity }}>
              {from}
            </span>
          ) : null}
          <span data-to style={{ position: "absolute", inset: 0, opacity: frame.newOpacity, transform: `translateY(${frame.newDy}px)` }}>
            {to}
          </span>
        </div>

        {tier ? (
          <div
            data-tier
            style={{ display: "flex", alignItems: "center", gap: ".75rem", margin: "1rem 0 0", fontFamily: SERIF, fontWeight: 600, letterSpacing: ".12em" }}
          >
            <span aria-hidden="true" style={{ flex: 1, height: 2, background: "var(--gold-500)" }} />
            {tier.toUpperCase()}
            <span aria-hidden="true" style={{ flex: 1, height: 2, background: "var(--gold-500)" }} />
          </div>
        ) : null}

        {place ? (
          <p data-place style={{ margin: ".75rem 0 0", color: "var(--text-secondary)" }}>
            {place === "shrine" ? "A shrine now stands at the cell where you earned it." : "A landmark now stands where you earned it."}
          </p>
        ) : null}
      </div>
    </div>
  )
}
