import { UpdateCommand } from "@aws-sdk/lib-dynamodb"

import { INGEST_RECEIPT_TABLE, type ReceiptDdb } from "@/src/pipeline/ingest-receipt"

/**
 * THE PER-ATHLETE FLOOD COUNTER. Ticket 0093, `08-security-privacy.md` §4.4 item 6.
 *
 * More than ~50 events in an hour for one athlete is not a human running, it is a loop — Strava
 * retrying a broken endpoint, or someone replaying a captured event with fresh ids. Past the
 * threshold the event is dropped with a 200, and the log line `webhook-flood` feeds a metric filter
 * whose alarm emails the operator (`amplify/backend.ts`).
 *
 * ─── WHY KEYED ON THE USER, WHEN THE DESIGN SAYS `owner_id` ─────────────────
 *
 * The static owner map (0091) is one-to-one, so the user IS the athlete here, and keying on the
 * user keeps every source id out of this transport (D-100) and the athlete id out of a table key.
 * Only events that already passed every cheap filter reach this — a stranger's `owner_id` was
 * dropped in `accept()` without a write — so the counter costs nothing for noise.
 *
 * ─── ONE ROW PER (source, user, clock hour), IN THE RECEIPT TABLE ───────────
 *
 * The design puts it there (§4.4: "in the receipt table with a TTL"), so it needs no new table and
 * the role gains exactly one action, `UpdateItem`, which the stack restricts by
 * `dynamodb:LeadingKeys` to keys starting `rate#`: the public endpoint can bump a counter and can
 * still not modify a receipt. A fixed clock-hour window, not a sliding one — "~50 an hour" is a
 * tripwire for a loop, and a loop does not hide in the boundary between two hours.
 *
 * ─── WHAT IS NOT COUNTED ────────────────────────────────────────────────────
 *
 * The reconciliation sweep (0095) and the Sync button go through `acceptIngest` directly, never
 * through this Lambda, so neither can trip the counter or be counted by it. It is a defence for
 * the public endpoint and lives in the public endpoint's directory for that reason.
 */

/** §4.4: "more than ~50 events/hour for one athlete". The 51st event in an hour is the first dropped. */
export const OWNER_EVENTS_PER_HOUR = 50

/** Every key this module writes starts with this, and the IAM condition pins the role to it. */
export const RATE_KEY_PREFIX = "rate#"

/** The bucket outlives its hour by one more, so a late write in the hour is never the first again. */
const RATE_TTL_SECONDS = 2 * 60 * 60

/**
 * DEAUTHORIZATIONS GET THEIR OWN, MUCH TIGHTER BUDGET. Each one costs the worker a forced token
 * refresh against the provider (`lib/sources/deauthorization.ts`), so 50 forged ones an hour
 * would be 50 provider calls an hour. A real one arrives once, plus up to three Strava retries.
 * Past the budget it is dropped; if a real one were ever lost that way, the next use of the dead
 * token marks the connection `NEEDS_REAUTH` regardless, so nothing is silently wrong for long.
 */
export const DEAUTHS_PER_HOUR = 4

export type RateBucket = "events" | "deauth"

export function rateKeyFor(source: string, userId: string, now: Date, bucket: RateBucket = "events"): string {
  // `2026-10-16T12` — the clock hour, UTC.
  const hour = now.toISOString().slice(0, 13)
  return bucket === "events"
    ? `${RATE_KEY_PREFIX}${source}#${userId}#${hour}`
    : `${RATE_KEY_PREFIX}${source}#${userId}#${bucket}#${hour}`
}

export interface RateDeps {
  ddb: ReceiptDdb
  now?: () => Date
}

/**
 * Count one event and say whether it is within the budget. One `UpdateItem`, atomic `ADD`, so
 * concurrent invocations (at most five, by reserved concurrency) never lose a count.
 */
export async function countOwnerEvent(
  input: { source: string; userId: string; bucket?: RateBucket },
  deps: RateDeps,
): Promise<{ withinBudget: boolean; count: number }> {
  const now = deps.now?.() ?? new Date()
  const bucket = input.bucket ?? "events"
  const limit = bucket === "events" ? OWNER_EVENTS_PER_HOUR : DEAUTHS_PER_HOUR
  const out = await deps.ddb.send(
    new UpdateCommand({
      TableName: INGEST_RECEIPT_TABLE,
      Key: { ingestKey: rateKeyFor(input.source, input.userId, now, bucket) },
      UpdateExpression: "ADD #n :one SET #ttl = if_not_exists(#ttl, :ttl)",
      ExpressionAttributeNames: { "#n": "eventCount", "#ttl": "ttl" },
      ExpressionAttributeValues: {
        ":one": 1,
        ":ttl": Math.floor(now.getTime() / 1000) + RATE_TTL_SECONDS,
      },
      ReturnValues: "UPDATED_NEW",
    }),
  )
  const raw = (out as { Attributes?: { eventCount?: unknown } }).Attributes?.eventCount
  const count = typeof raw === "number" ? raw : Number(raw ?? 1)
  return { withinBudget: count <= limit, count }
}
