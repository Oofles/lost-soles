import { createHash } from "node:crypto"

import { entryActivityFields, isIanaZone, type WorkoutEntry } from "@/lib/log/workout-entry"
import { computeActivityId } from "@/src/domain/activity-id"
import type { NormalizedIngest, RawArchiveRef } from "@/src/domain/activity"
import { computeDedupeKey } from "@/src/domain/dedupe-key"

import { AUTHENTICATED_SUB_HEADER } from "../principal"
import type { AckResult, InboundRequest, IngestJob, SourceAdapter } from "../types"

/**
 * THE MANUAL ADAPTER. Ticket 0069, D-060/D-061/D-100.
 *
 * In-app logging is another source, not a special case: the `logWorkout` mutation drives
 * this adapter through the same four phases and the same `processActivity` as any other
 * ingest, so the pipeline cannot tell a hand-logged pushup from a Strava run.
 *
 * What makes it distinct is only what it OMITS. There is no `Trace`, so `hasTrace: false`,
 * `traceRef: null`, and the pipeline's own `!trace` check projects no cells, writes no
 * `ExploredCell`, publishes no generation and awards no Cartography (I-27). There is no
 * `grantsDiscovery: false` anywhere, on purpose.
 *
 * ─── WHAT THE SOURCE IS ──────────────────────────────────────────────────────
 *
 * The "source" is the `logWorkout` handler, and the bytes it hands `accept()` are the
 * `WorkoutEntry` it has already validated against the user's registry
 * (`parseWorkoutEntry`). Validation lives there and not here because it needs the
 * registry, and every phase here is registry-free by contract. What is archived is
 * therefore the CLEAN entry: unknown keys gone, `occurredAt` filled. That makes the
 * archive a faithful record of what was scored, and makes a retried submission
 * byte-identical — so the content-addressed archive PUT writes nothing the second time.
 *
 * ─── WHO ─────────────────────────────────────────────────────────────────────
 *
 * Identity arrives in the `AUTHENTICATED_SUB_HEADER` (`../principal.ts`), which the handler sets from the
 * AppSync identity and never from the client's arguments. `InboundRequest` has no
 * principal field because webhook sources authenticate by signature, not by user; this
 * is the one source whose caller IS the user. Nothing outside the handler builds an
 * `InboundRequest` for this adapter.
 */

/** `fetchRaw`'s `schemaHint`. Bumped when what this adapter archives changes shape. */
export const MANUAL_SCHEMA_HINT = "manual/workout-entry@1"

/** `IngestJob.meta` for this source: the archived bytes, verbatim, as UTF-8. */
interface ManualIngestMeta {
  body: string
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * Read the archived entry back. STRUCTURAL ONLY — the registry check already ran before
 * these bytes existed. It still refuses anything that could not have come from
 * `parseWorkoutEntry`, because `normalize` must also replay archives years from now and a
 * corrupt object should fail loudly there rather than score as nothing.
 */
function readEntry(raw: Buffer | string): WorkoutEntry {
  const parsed: unknown = JSON.parse(raw.toString())
  if (!isRecord(parsed)) throw new Error("manual entry is not a JSON object")
  const { exerciseId, sets, occurredAt, idempotencyKey, timezone } = parsed
  if (typeof exerciseId !== "string" || exerciseId === "") throw new Error("manual entry has no exerciseId")
  if (!Array.isArray(sets) || sets.length === 0 || !sets.every(isRecord)) {
    throw new Error("manual entry has no sets")
  }
  if (typeof occurredAt !== "string" || Number.isNaN(Date.parse(occurredAt))) {
    throw new Error("manual entry has no usable occurredAt")
  }
  if (typeof idempotencyKey !== "string" || idempotencyKey === "") {
    throw new Error("manual entry has no idempotencyKey")
  }
  if (timezone !== undefined && !isIanaZone(timezone)) throw new Error("manual entry has a bad timezone")
  return {
    exerciseId,
    sets: sets as WorkoutEntry["sets"],
    occurredAt,
    idempotencyKey,
    ...(timezone !== undefined ? { timezone } : {}),
  }
}

/**
 * `ingestKey` — the receipt's idempotency key. Namespaced by user so two accounts cannot
 * collide on a client-minted key, and by source so it cannot collide with Strava's.
 */
export function manualIngestKey(userId: string, idempotencyKey: string): string {
  return createHash("sha256").update(`manual:${userId}:${idempotencyKey}`).digest("hex")
}

/**
 * `"YYYY-MM-DDTHH:mm:ss"` for an instant in a zone. With no zone, UTC's wall clock — the
 * same fallback a source that sends no zone gets, stated rather than guessed.
 */
export function localWallClock(isoUtc: string, timezone: string | null): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone ?? "UTC",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(isoUtc))
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
}

export const manualAdapter: SourceAdapter<null> = {
  id: "manual",

  /**
   * PHASE 1. Builds the one `ingest` command. A body or principal it cannot read is a 400
   * with no commands — the handler validated first, so reaching that branch is a bug in
   * the handler, and it must not become a write.
   */
  async accept(req: InboundRequest): Promise<AckResult> {
    const userId = req.headers[AUTHENTICATED_SUB_HEADER]
    if (!userId) return { status: 401, commands: [] }
    let entry: WorkoutEntry
    try {
      entry = readEntry(req.rawBody)
    } catch (e) {
      return { status: 400, body: { error: (e as Error).message }, commands: [] }
    }
    const meta: ManualIngestMeta = { body: req.rawBody.toString("utf8") }
    const job: IngestJob = {
      ingestKey: manualIngestKey(userId, entry.idempotencyKey),
      userId,
      source: "manual",
      externalId: entry.idempotencyKey,
      command: "ingest",
      startedAt: new Date(entry.occurredAt).toISOString(),
      meta,
      enqueuedAt: new Date().toISOString(),
    }
    return { status: 202, commands: [{ kind: "ingest", job }] }
  },

  /** PHASE 2. No network: the bytes travelled on the job. Returned exactly as accepted. */
  async fetchRaw(job: IngestJob) {
    const meta = job.meta as Partial<ManualIngestMeta> | null
    if (typeof meta?.body !== "string") {
      throw new Error(`manual job ${job.ingestKey} carries no body in meta`)
    }
    return {
      body: Buffer.from(meta.body, "utf8"),
      contentType: "application/json",
      ext: "json",
      schemaHint: MANUAL_SCHEMA_HINT,
    }
  },

  /** PHASE 3. PURE. The archived entry, and the job's identity, become an `Activity`. */
  normalize(raw: Buffer, ref: RawArchiveRef, job: IngestJob): NormalizedIngest {
    const entry = readEntry(raw)
    const { startedAt, sets } = entryActivityFields(entry)
    const timezone = entry.timezone ?? null
    return {
      activity: {
        activityId: computeActivityId(job.userId, job.source, job.externalId),
        userId: job.userId,
        kind: "strength",
        startedAt,
        startedAtLocal: localWallClock(startedAt, timezone),
        timezone,
        // Time under tension where the measure is time (planks); zero where it is a count.
        elapsedS: sets.reduce((sum, s) => sum + (s.durationS ?? 0), 0),
        source: {
          source: job.source,
          externalId: job.externalId,
          sourceTypeRaw: entry.exerciseId,
          fetchedAt: ref.archivedAt,
        },
        raw: ref,
        traceRef: null,
        hasTrace: false,
        sets,
        dedupeKey: computeDedupeKey(job.userId, Date.parse(startedAt)),
        ingestedAt: ref.archivedAt,
        revision: 1,
      },
    }
  },

  /**
   * PHASE 4. Mandatory (D-140) and empty: there is no remote history to reconcile. Every
   * manual log arrives through `accept`, synchronously, with the caller waiting on it.
   */
  async *listSince(): AsyncIterable<IngestJob> {
    return
  },
}
