import { kmText, type Tally } from "@/lib/run-moment/tally"
import { runDate, runDistance, xpNumber } from "@/lib/runs/format"
import type { RunSummary } from "@/lib/runs/wire"

import { tallyFooters } from "./run-ledger"

/**
 * THE SEQUENCE, IN WORDS. Ticket `0112`, `06-ui-ux.md` §9.4.
 *
 * *"The §3 sequence announces each beat through a single `aria-live="polite"` region in beat order,
 * so the reveal is narrated in the same sequence a sighted user sees."* `RunSequence` owns the one
 * region and appends to it as each beat begins; this module is what it appends. Pure, so the words
 * and their order are tested without a map, a clock or a screen reader.
 *
 * The words are each beat's SETTLED content, never a frame of it: a count-up read aloud is a string
 * of numbers, and a polite region that changes sixty times a second is a region nobody can follow.
 *
 * §3.5 HOLDS HERE TOO. A run that revealed nothing new is not told so: no "0 cells", no "No new"
 * (`0085` criterion 10) — the route joins the web, and the tally's record line says what it added.
 */

type Narrated = Pick<RunSummary, "name" | "startedAtLocal" | "newCellCount" | "rearmedCellCount">

/** Beat 1: which run, then what the map just did. */
export function revealWords(summary: Narrated): string {
  const title = `${summary.name ?? "Your run"}, ${runDate(summary.startedAtLocal)}.`
  const ground = [
    summary.newCellCount > 0 ? `${xpNumber(summary.newCellCount)} new ${summary.newCellCount === 1 ? "cell" : "cells"} revealed` : null,
    summary.rearmedCellCount > 0 ? `${xpNumber(summary.rearmedCellCount)} remembered` : null,
  ].filter(Boolean)
  return ground.length > 0 ? `${title} ${ground.join(", ")}.` : `${title} The route joins your web.`
}

/**
 * Beat 2, ONE STRING PER STAGGERED LINE, index for index with the lines beat 2 counts in (the skill
 * rows, then `tallyFooters`), so the sequence can speak line `i` as line `i` begins and a level-up
 * card lands between its own line and the next — beat 3 interrupting beat 2, as it does on screen.
 */
export function tallyWords(
  tally: Tally,
  summary: Narrated & Partial<Pick<RunSummary, "distanceM">>,
  skillName: (id: string) => string,
): string[] {
  const skills = tally.lines.map(
    (l) => `${skillName(l.skillId)}, plus ${xpNumber(l.xp)} XP${l.standing ? `, level ${l.standing.levelAfter}` : ""}.`,
  )
  const footers = tallyFooters(tally, summary).map((kind) => {
    switch (kind) {
      case "cells":
        return (
          [
            summary.newCellCount > 0 ? `${xpNumber(summary.newCellCount)} cells claimed` : null,
            summary.rearmedCellCount > 0 ? `${xpNumber(summary.rearmedCellCount)} remembered` : null,
          ]
            .filter(Boolean)
            .join(", ") + "."
        )
      case "record":
        return `${runDistance(summary.distanceM ?? null)} added to the record.`
      case "km":
        return `${kmText(tally.newKm!)} never run before.`
      case "total":
        return tally.total
          ? `Total XP ${xpNumber(tally.total.after)}, plus ${xpNumber(tally.total.after - tally.total.before)}.`
          : `Total XP plus ${xpNumber(tally.runXp)}.`
      case "level":
        return `Total Level ${tally.totalLevel}.`
    }
  })
  return [...skills, ...footers]
}

/** One thing the narration says, in the order `narrationOrder` puts it. */
export type Narration =
  | { beat: 1 }
  | { beat: 2; line: number }
  | { beat: 3; trigger: number }
  | { beat: 4 }
  | { beat: 5 }

/**
 * THE ORDER THE SEQUENCE SPEAKS IN, as a pure function of beat 2's clock: beat 1 first; each tally
 * line at `lineStart`; each card trigger at its `at`, AFTER every line that has begun by then (beat
 * 2's clock stops under a card, so nothing later can slip in front of it); beat 4 at `beat4Start`
 * and beat 5 at `beat5Start`. `RunSequence`'s beat 2 tick produces exactly this order; this is
 * where it is written down and tested, without a frame loop.
 */
export function narrationOrder(input: {
  lines: number
  lineStart: (i: number, count: number) => number
  triggers: readonly { at: number }[]
  beat4Start: number
  beat5Start: number
}): Narration[] {
  const events: { at: number; rank: number; n: Narration }[] = []
  for (let i = 0; i < input.lines; i++) events.push({ at: input.lineStart(i, input.lines), rank: 0, n: { beat: 2, line: i } })
  input.triggers.forEach((t, i) => events.push({ at: t.at, rank: 1, n: { beat: 3, trigger: i } }))
  events.push({ at: input.beat4Start, rank: 2, n: { beat: 4 } }, { at: input.beat5Start, rank: 2, n: { beat: 5 } })
  events.sort((a, b) => a.at - b.at || a.rank - b.rank)
  return [{ beat: 1 }, ...events.map((e) => e.n)]
}
