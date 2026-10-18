import type { H3Index } from "h3-js"

import { HOLD_PENDING, type HomeHold } from "@/lib/fog/home-territory"
import type { RunFeatureCollection } from "@/lib/runs/wire"

import type { BackfillMark } from "./batch"

/**
 * WHAT HOME DOES ABOUT A HISTORICAL IMPORT. Ticket `0257`. The decisions, without the browser.
 *
 * The aggregate reveal plays on the NEXT MAP VISIT after the import, on any device, once per device
 * (`revealSeenKey` in the `seen` store). Until home knows whether one is due, the fog waits — the
 * same pending state `0273` gave an unseen run (D-333) — because drawing the imported ground and
 * then fogging it back over for the reveal is the flash that rule exists to prevent.
 */

export type BackfillDue =
  /** Not known yet: no answer, or a cached answer from before `0257` that says nothing about it. */
  | { kind: "unknown" }
  | { kind: "none" }
  | { kind: "due"; mark: BackfillMark }

/**
 * From the latest-run answer that home already waits for. A network answer always carries the field
 * (`null` or a mark); one without it is a pre-`0257` cache, or a failed request answering with the
 * cache — and a failed request counts as an answer (D-333), so an offline open never freezes.
 */
export function backfillDue(latest: RunFeatureCollection, answer: { network: boolean } | null): BackfillDue {
  if (!answer) return { kind: "unknown" }
  const mark = latest.backfill
  if (mark === undefined) return answer.network ? { kind: "none" } : { kind: "unknown" }
  return mark === null ? { kind: "none" } : { kind: "due", mark }
}

/** Where home's handling of a due batch has got to (`useBackfillReveal`). */
export type RevealPhaseKind = "checking" | "loading" | "ready" | "playing" | "skip" | "done"

/**
 * WHAT THE IMPORT HOLDS BACK, from where its handling has got to: PENDING while home cannot say (no
 * answer yet, the `seen` flag being read, the blobs loading), the import's cells while its reveal is
 * ready or playing, and nothing once it has played (or will not play this visit).
 *
 * `phase` is for the batch `due` names; a phase left over from another batch counts as none yet.
 */
export function backfillHold(
  due: BackfillDue,
  phase: { id: string; kind: RevealPhaseKind; hold?: readonly H3Index[] } | null,
): HomeHold | null {
  if (due.kind === "unknown") return HOLD_PENDING
  if (due.kind === "none") return null
  if (!phase || phase.id !== due.mark.batchId) return HOLD_PENDING
  if (phase.kind === "checking" || phase.kind === "loading") return HOLD_PENDING
  if (phase.kind === "ready" || phase.kind === "playing") return phase.hold ?? []
  return null
}

/**
 * The latest run's `seen`, for the plinth: a backfilled run is seen on EVERY device — the import's
 * aggregate reveal stands for it — so its flag is not even read. `null` while a real flag is read.
 */
export function latestSeen(latest: RunFeatureCollection, flag: boolean | null): boolean | null {
  const run = latest.features[0]?.properties
  if (!run || run.backfilled) return true
  return flag
}

/**
 * Two holds as one: pending if either is, else every cell either holds back. `null` (nothing held)
 * only when both are. The fog layer reads one hold (`useFogMask`).
 */
export function mergeHolds(a: HomeHold | null, b: HomeHold | null): HomeHold | null {
  if (a === HOLD_PENDING || b === HOLD_PENDING) return HOLD_PENDING
  // `null` and `[]` differ to the map: `[]` still turns the optimistic corridor off (`MapShell`).
  if (a === null) return b
  if (b === null || b.length === 0) return a
  if (a.length === 0) return b
  return [...new Set<H3Index>([...a, ...b])]
}
