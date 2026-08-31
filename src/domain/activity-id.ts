import { createHash } from "node:crypto"

import type { SourceId } from "./activity"

/**
 * `activityId` — `sha256(`${userId}:${source}:${externalId}`)`.
 *
 * Deterministic on purpose, and it is the whole idempotency story
 * (`contracts/ingestion-contract.md` §2, conflict #6). Re-ingesting the same activity
 * recomputes the same id and overwrites rather than duplicating. A ULID would mint a
 * fresh id on every webhook replay — and a source that retries three times then drops
 * would leave three copies of one run, permanently, on a map that cannot re-fog (D-020).
 * `revision` tracks source-side edits; the id never changes.
 *
 * WHY THIS IS NOT IN `./activity.ts`. That module is types only and emits no runtime
 * code, so importing an `Activity` type can never drag `node:crypto` into a client
 * bundle. The contract does not say where this helper lives; keeping the type module
 * runtime-free is a judgement call made here, recorded so it is not undone by accident.
 *
 * PURE: no clock, no randomness, no I/O. Same three inputs, same id, forever — which is
 * exactly what the test asserts, because "deterministic" is the property the design
 * depends on rather than an implementation detail.
 *
 * Ticket 0025.
 */
export function computeActivityId(
  userId: string,
  source: SourceId,
  externalId: string,
): string {
  // The separator matters: without it, ("ab", "c", …) and ("a", "bc", …) would collide.
  // A colon cannot appear in a SourceId, so the three fields stay unambiguous.
  return createHash("sha256").update(`${userId}:${source}:${externalId}`).digest("hex")
}
