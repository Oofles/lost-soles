/**
 * THE BACKFILL BATCH RECORD, AS DATA. Ticket `0257`. `06-ui-ux.md` §3.4 *Backfill*; D-298.
 *
 * A historical import (`0177`) is not a run, and it must not play like 97 of them. When the import
 * finishes, the server writes ONE record describing it: the window the import ran in, which
 * activities it brought in, and the account's standing before and after. Every device reads it, so
 * the decision about what is "new" is made once, on the server, and not per device:
 *
 *   - the next visit to the map, on any device, plays ONE aggregate reveal for the whole batch (once
 *     per device: the `seen` store remembers it under `revealSeenKey`);
 *   - every activity in the batch counts as NOT NEW, on every device: no `1 new run` line on the
 *     plinth, no gold row in the Chronicle (`isBackfilled`), whatever that device's `seen` store says.
 *
 * Pure and browser-safe: no AWS SDK here. The record's reader and writer are `store.ts`.
 *
 * ─── WHY "BEFORE" IS A SNAPSHOT, NOT A SUBTRACTION ──────────────────────────
 *
 * After the import, the XP replay re-folds the whole history (D-221), which moves credit between old
 * and new activities. So "today's totals minus the batch's XP" is not what the user was shown before
 * the import. The SkillState snapshot written after every ingest (D-143) IS: `before` is the newest
 * snapshot taken before the window opened, and its `generation` names the explored-set blob the
 * user's map was drawn from. Both are immutable objects, so the record can be rebuilt at any time.
 */

import type { CachedSkill } from "@/lib/log/optimistic"

/** The record's format. Bumped only when a reader written for 1 could mis-read a record. */
export const BACKFILL_RECORD_VERSION = 1

/** The account at one moment: its map's generation and size, and what the skills panel showed. */
export interface BackfillStanding {
  /** The explored-set generation (`manifest.json`). 0: nothing had ever been published. */
  generation: number
  /** Cells in that generation's blob. */
  cells: number
  /** ACTIVE activities on the account at that moment. */
  activities: number
  /** Each skill's displayed XP, in the shape the plinth and `/skills` cache (`CachedSkill`). */
  skills: CachedSkill[]
  /** For the human reading the record. The browser recomputes both through `skillsPanel`. */
  totalLevel: number
  totalXp: number
}

/** What the browser is told. Everything in the record except the activity ids. */
export interface BackfillMark {
  /** Stable for one import: the window's opening instant. A rewrite of the record keeps it. */
  batchId: string
  /** When the import ran — the instants its activities' `ingestedAt` fall between. */
  window: { from: string; to: string }
  /** The batch itself: how many activities, and the span of their `startedAt`. */
  imported: { count: number; firstStartedAt: string | null; lastStartedAt: string | null }
  before: BackfillStanding
  after: BackfillStanding
}

/** The stored record (`users/<uid>/backfill/batch.json`). */
export interface BackfillBatch extends BackfillMark {
  version: typeof BACKFILL_RECORD_VERSION
  /** When the record was written. Audit only. */
  writtenAt: string
  /** Every activity the import brought in. What `isBackfilled` reads. */
  activityIds: string[]
}

/**
 * The key in the per-device `seen` store (`lib/run-moment/seen.ts`) that says this device has played
 * the batch's reveal. Prefixed, so it can never collide with an activity id (a 64-hex sha256).
 */
export const revealSeenKey = (batchId: string): string => `backfill:${batchId}`

/** The record minus its ids, for the wire. */
export function markOf(batch: BackfillBatch): BackfillMark {
  const { batchId, window, imported, before, after } = batch
  return { batchId, window, imported, before, after }
}

/** Whether `activityId` came in with the batch, and so is never "new" on any device. */
export function isBackfilled(batch: Pick<BackfillBatch, "activityIds"> | null, activityId: string): boolean {
  return batch !== null && batch.activityIds.includes(activityId)
}

const isStanding = (v: unknown): v is BackfillStanding => {
  const s = v as BackfillStanding | null
  return (
    !!s &&
    Number.isSafeInteger(s.generation) &&
    Number.isFinite(s.cells) &&
    Number.isFinite(s.activities) &&
    Array.isArray(s.skills) &&
    s.skills.every((k) => typeof k?.skillId === "string" && Number.isFinite(k.xp))
  )
}

/**
 * A record read off S3, checked. Anything malformed is `null` — "no batch" — never a guess: a
 * half-read record could hold every activity back, or play a reveal over the wrong generations.
 */
export function parseBackfillBatch(bytes: Uint8Array | string): BackfillBatch | null {
  let raw: unknown
  try {
    raw = JSON.parse(typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes))
  } catch {
    return null
  }
  const b = raw as BackfillBatch | null
  if (
    !b ||
    b.version !== BACKFILL_RECORD_VERSION ||
    typeof b.batchId !== "string" ||
    typeof b.window?.from !== "string" ||
    typeof b.window?.to !== "string" ||
    !Array.isArray(b.activityIds) ||
    !b.activityIds.every((id) => typeof id === "string") ||
    !isStanding(b.before) ||
    !isStanding(b.after) ||
    typeof b.imported?.count !== "number"
  ) {
    return null
  }
  return b
}

/**
 * The answer `/api/runs/latest` serves, with the batch folded in: the mark at the collection level
 * (the plinth and the reveal read it), and `backfilled` on the latest run when it came in with the
 * batch. Generic over the collection, so this module needs nothing from the wire file.
 */
export function withBackfill<
  C extends { features: { properties: { activityId: string; backfilled?: true } }[]; backfill?: BackfillMark | null },
>(collection: C, batch: BackfillBatch | null): C {
  return {
    ...collection,
    backfill: batch ? markOf(batch) : null,
    features: collection.features.map((f) =>
      isBackfilled(batch, f.properties.activityId) ? { ...f, properties: { ...f.properties, backfilled: true as const } } : f,
    ),
  }
}

/** The Chronicle's page, with `backfilled` on each row that came in with the batch. */
export function chronicleWithBackfill<P extends { items: { activityId: string; backfilled?: true }[] }>(
  page: P,
  batch: BackfillBatch | null,
): P {
  if (!batch) return page
  return { ...page, items: page.items.map((r) => (isBackfilled(batch, r.activityId) ? { ...r, backfilled: true as const } : r)) }
}
