/**
 * THE `logWorkout` MUTATION, AS A FUNCTION. Ticket 0069, `02-data-model.md` §2.11, I-20.
 *
 * `amplify/functions/log-workout/handler.ts` owns AppSync and AWS clients and nothing else;
 * this owns the order, so it can be tested without either. The same split as
 * `processActivity` and its handler, for the same reason.
 *
 * ─── THE ONE CARVE-OUT IN I-20 ──────────────────────────────────────────────
 *
 * The client may not write XP, cells or activities, except through here — and "here" is the
 * SAME server-side pipeline any other ingest runs: the manual adapter's four phases, then
 * `processActivity`'s archive, dedupe, gate, score and one transaction. The client says what
 * it did. What that is worth is decided on this side, under the user's ruleset version.
 *
 * ─── SYNCHRONOUS, NOT QUEUED ───────────────────────────────────────────────
 *
 * A webhook enqueues because its source gives it two seconds and a fetch to make. This
 * source has nothing to fetch, and its caller is waiting on the answer; the background-sync
 * queue that makes it retry-safe lives in the client (`0068`), keyed on `idempotencyKey`.
 */

import { AUTHENTICATED_SUB_HEADER } from "@/src/adapters/principal"
import { getAdapter } from "@/src/adapters/registry"
import type { IngestJob } from "@/src/adapters/types"
import { computeActivityId } from "@/src/domain/activity-id"
import type { ProcessDeps } from "@/src/pipeline/process-activity"
import { acceptIngest } from "@/src/pipeline/ingest-receipt"
import { processActivity } from "@/src/pipeline/process-activity"
import type { Registry } from "@/src/pipeline/worker-rules"

import { parseWorkoutEntry, WorkoutEntryError } from "./workout-entry"

/** Everything `processActivity` needs except what this function decides for it. */
export type LogWorkoutDeps = Omit<ProcessDeps<unknown>, "adapter" | "credentials" | "registry"> & {
  /** The user's ruleset — `rulesForUser` in production. Validation and scoring use the same one. */
  registry(userId: string): Promise<Registry>
  /** The default for an absent `occurredAt`. Injected so a test is not at the mercy of the clock. */
  now?: () => Date
}

/**
 * What the client gets back. Measured work in, a receipt out — `xpAwarded` is reported, never
 * accepted. `logged: false` is a re-delivery of a key that already landed, and carries the
 * ORIGINAL award, so the client's retry loop can treat both outcomes as success.
 */
export interface LogWorkoutResult {
  logged: boolean
  activityId: string
  xpAwarded: number
}

/** A refusal the client caused. The handler maps it to a GraphQL error the queue must not retry. */
export class LogWorkoutRefused extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = "LogWorkoutRefused"
  }
}

/** The manual source id, from the shared `SourceId` vocabulary. */
const SOURCE = "manual"

export async function logWorkout(
  args: Record<string, unknown>,
  userId: string,
  deps: LogWorkoutDeps,
): Promise<LogWorkoutResult> {
  const registry = await deps.registry(userId)
  const now = deps.now ?? (() => new Date())

  // `occurredAt` is optional on the wire and required on the entry (D-280): absent means
  // "now", and it is filled HERE so that what is archived is the instant that was scored.
  const withDefaults = {
    ...args,
    occurredAt: args.occurredAt ?? now().toISOString(),
  }

  let entry
  try {
    entry = parseWorkoutEntry(withDefaults, registry)
  } catch (e) {
    if (e instanceof WorkoutEntryError) throw new LogWorkoutRefused(e.code, e.message)
    throw e
  }

  const adapter = getAdapter(SOURCE)
  const ack = await adapter.accept({
    source: SOURCE,
    method: "POST",
    headers: { [AUTHENTICATED_SUB_HEADER]: userId },
    query: {},
    rawBody: Buffer.from(JSON.stringify(entry), "utf8"),
  })
  const command = ack.commands[0]
  if (ack.status >= 300 || command?.kind !== "ingest") {
    // The entry was validated above, so this is a handler/adapter disagreement — a bug, and
    // never something the client can fix by changing what it sent.
    throw new Error(`manual adapter refused a validated entry with ${ack.status}: ${JSON.stringify(ack.body)}`)
  }
  const job: IngestJob = command.job
  // A pure function of the job, so it is known on every outcome — `already-done` carries none.
  const activityId = computeActivityId(job.userId, job.source, job.externalId)

  // LAYER 1, THE ACCEPT GATE (`01` §4 step 3) — the step a queue producer runs before it
  // enqueues, and `recordDelivery` refuses a job that never passed it. A `duplicate` here is
  // a re-submitted key and is NOT a reason to stop: `processActivity` still runs, finds the
  // receipt `DONE` at the score gate, and returns the original award — or finds it
  // `PROCESSING` and throws, so the client retries.
  await acceptIngest({ ingestKey: job.ingestKey, userId, activityId, source: job.source }, deps.receipt)

  const result = await processActivity(job, {
    ...deps,
    adapter,
    credentials: async () => null,
    registry,
  })

  switch (result.outcome) {
    case "persisted":
      return { logged: true, activityId, xpAwarded: result.xp.xpAwarded }
    case "already-done":
      return { logged: false, activityId, xpAwarded: result.xpAwarded }
    case "duplicate":
      // Unreachable while D-281 holds (an activity with sets is never a duplicate); reported
      // honestly rather than as a log, so a regression there is not mistaken for success.
      throw new Error(`manual log ${activityId} was judged a duplicate of ${result.duplicateOf}`)
    case "not-claimable":
      // Another delivery of the same key is mid-flight. Thrown so the client queue retries.
      throw new Error(`manual log ${job.ingestKey} is ${result.status}; retry later`)
  }
}
