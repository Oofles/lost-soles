import type { IngestJob, SourceAdapter } from "@/src/adapters/types"
import type { NormalizedIngest, RawArchiveRef } from "@/src/domain/activity"

import { archiveRaw, type ArchiveDeps } from "./archive"

/**
 * THE ORDERING. Ticket 0039, D-121.2, `01-architecture.md` §3:
 *
 *     fetchRaw()  →  PutObject raw/…  →  normalize()
 *
 * ─── WHY THIS IS A MODULE AND NOT THREE LINES IN THE WORKER ─────────────────
 *
 * Ticket 0039's own note is the argument: *"Concurrency here
 * (`Promise.all([archive, normalize])`) would pass every test and silently destroy
 * the D-101 guarantee the first time an archive PUT failed."*
 *
 * That is a real hazard rather than a hypothetical one, because the parallel version
 * is FASTER and LOOKS BETTER. Two independent-seeming awaits sitting next to each
 * other in a handler are exactly what a later reader — or a later agent optimising a
 * cold start — reaches for. And it would work: every activity would import
 * correctly, every test would stay green, and the damage would appear only on the
 * day an archive PUT failed and the pipeline had already normalized, persisted and
 * awarded XP for bytes that were never written down.
 *
 * So the ordering lives in one function with one test, rather than as a convention
 * in a handler that has five other things to do (ticket 0042). Making it a named,
 * separately-tested seam is the difference between an invariant and a habit.
 *
 * ─── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
 *
 * Credentials, the receipt score gate, persistence, cell writes. Those are 0040,
 * 0041, 0042 and capability `07`. This function is exactly the three steps whose
 * ORDER is the invariant, and nothing else — a function that also loaded
 * credentials would have a second reason to fail and its ordering test would then
 * be asserting two things at once.
 */

/**
 * Runs the three phases in the only order D-101 permits, and returns both halves:
 * the normalized result and the ref it was normalized from.
 *
 * The ref is returned as well as being passed into `normalize` because the caller
 * needs it independently — `Activity.raw` carries it, and 0044's failure reporting
 * needs a key to point at even when normalize is what threw.
 */
export async function fetchArchiveNormalize<TCreds>(
  adapter: SourceAdapter<TCreds>,
  job: IngestJob,
  creds: TCreds,
  deps: ArchiveDeps,
): Promise<{ ingest: NormalizedIngest; ref: RawArchiveRef }> {
  /**
   * PHASE 2. Network. Returns the bytes verbatim and DECLARES what they are —
   * content type, extension, schema hint. Nothing below inspects them.
   */
  const raw = await adapter.fetchRaw(job, creds)

  /**
   * THE ARCHIVE, AWAITED. If this throws, we return here and `normalize` below is
   * never reached — the message goes back to the queue and is retried, which is the
   * correct outcome: a failed archive is a failed ingest, not a degraded one.
   *
   * `await` on its own line, with the result used on the next, is not a stylistic
   * choice. It is the shape that makes `Promise.all` a visible edit rather than a
   * plausible refactor.
   */
  const ref = await archiveRaw(
    {
      userId: job.userId,
      source: job.source,
      externalId: job.externalId,
      body: raw.body,
      contentType: raw.contentType,
      ext: raw.ext,
      schemaHint: raw.schemaHint,
    },
    deps,
  )

  /**
   * PHASE 3. PURE, synchronous, and the only step here that could be re-run years
   * from now against the object the line above just wrote. That is the entire
   * reason the two are in this order.
   */
  return { ingest: adapter.normalize(raw.body, ref, job), ref }
}
