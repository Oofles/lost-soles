import { UpdateCommand, type UpdateCommandInput } from "@aws-sdk/lib-dynamodb"
import type { H3Index } from "h3-js"

import { parentOf } from "@/src/domain/fog"

/**
 * THE FOG, WRITTEN DOWN. Ticket `0047`. `02-data-model.md` T6, `01-architecture.md` §4,
 * `05-fog-of-war.md` §2.4, D-120, D-144, I-7, I-8, I-9, I-10.
 *
 * Three invariants live in this file and **not one of them can be repaired later**,
 * because the timestamps they protect cannot be invented after the fact.
 *
 * ─── 1. TIMESTAMPS, NEVER A PRESENCE BIT (D-120, I-9) ───────────────────────
 *
 * Discovery scoring is `activity.startedAt − lastRunAt`. A boolean makes the six-month
 * re-arm mechanic unimplementable, and the loss is not recoverable by any later migration
 * — the information was never written. `firstRunAt` is not called out by D-120 at all and
 * is written anyway, because lifetime statistics need it and it **cannot be reconstructed
 * from `lastRunAt` once the cell has been re-run**. There is no later.
 *
 * ─── 2. `min` AND `max`, NEVER A PLAIN `SET`, NEVER READ-MODIFY-WRITE (I-8) ──
 *
 * Activities arrive out of order: backfills, webhook redeliveries, a future GPX import.
 * A plain `SET` lets a 2024 import stomp a 2026 `lastRunAt` and silently corrupt every
 * future discovery decision on that cell. So the `min`/`max` are expressed as CONDITIONS
 * on the write itself rather than as arithmetic on a value someone read first — two
 * writes, both idempotent, no lost update. See `cellUpdate` and `firstRunBackfill`.
 *
 * ─── 3. OUTSIDE THE INGEST TRANSACTION, AND BEFORE IT (D-144, I-10) ─────────
 *
 * A run produces 40–130 cells and `TransactWriteItems` caps at 100 items, so atomicity
 * across cells and XP is not available at any price. Since one of the two has to be able
 * to lag, the chosen skew is **map ahead of XP, never the reverse**:
 *
 *   - Revealed-but-unscored ground SELF-HEALS. The receipt never reached `DONE`, so a
 *     redelivery re-scores it, and these writes are conditional no-ops the second time.
 *   - Scored-but-unrevealed ground could only be repaired by re-fogging, and no code path
 *     in this system is allowed to do that (D-020, I-7).
 *
 * `src/pipeline/persist.ts`'s `assertNoCellWrites` is the other half of this: it throws if
 * anything shaped like a cell key reaches the transaction. That guard was written in `0041`
 * against the key prefix below, before this writer existed.
 *
 * ─── WHY `UpdateItem` AND NOT `BatchWriteItem` ──────────────────────────────
 *
 * `0047` criterion 8 asked for `BatchWriteItem` with its 25-item limit. **That API cannot
 * express this write.** `BatchWriteItem` carries only `PutRequest` and `DeleteRequest` —
 * no `UpdateExpression`, no `ConditionExpression` — so it is structurally incompatible
 * with criterion 3's conditional update, and a `Put` would be the plain `SET` I-8 exists
 * to forbid. `02-data-model.md` WP-3 agrees and always did: *"40–130 `UpdateItem` + 1–2
 * AGG"*. The criterion was amended; see the ticket's Resolution.
 *
 * ─── WHAT THIS FILE DELIBERATELY DOES NOT DO ────────────────────────────────
 *
 *   - **The AGG aggregate** (T6 item type B) belongs to `0049`, whose title carries it.
 *   - **`discoveryCount`** is classification output and belongs to `0048`. The `ADD` term
 *     ships here with a credit of zero so that `0048` supplies a number rather than
 *     restructuring the one expression in this system that must stay boring.
 *   - **Deletion.** Not as a restriction but as an absence: there is no delete in this
 *     module and the worker's IAM role never asks for `dynamodb:DeleteItem` (I-7).
 */

/**
 * T6's physical table name, STATED HERE AS WELL AS IN `amplify/backend.ts`, and
 * `explored-cells-table.test.ts` asserts the two agree.
 *
 * The same trade `LostSolesIngestReceipt` and `LostSolesSourceAccount` record. These are
 * CDK tables with `removalPolicy: RETAIN` (§7.2/5) precisely so they survive a stack
 * teardown — which means a generated name would be orphaned by the teardown it is
 * supposed to survive, and the next deploy would create an empty table beside a full one.
 * For the table that holds a map which can never re-fog, that is the wrong failure.
 */
export const EXPLORED_CELL_TABLE = "LostSolesExploredCell"

/**
 * `U#<uid>#C#<res6parent>` / `<res10cell>`. T6, verbatim.
 *
 * **The prefix is load-bearing in two places at once.** `persist.ts`'s `assertNoCellWrites`
 * recognises a cell write by exactly this shape, so changing it here silently disarms the
 * I-10 guard; `explored-cells.test.ts` asserts the guard still fires on a key this function
 * produces, which is the only way that coupling stays honest.
 *
 * NO SOURCE ANYWHERE IN THE KEY OR THE ITEM (§7.4). That absence is why "remove Strava's
 * cells" is not an operation this schema can express — which is the structural reason the
 * map cannot re-fog, rather than a policy anyone has to remember.
 */
export function cellKey(userId: string, cell: H3Index): { pk: string; sk: string } {
  return { pk: `U#${userId}#C#${parentOf(cell)}`, sk: cell }
}

/** The epoch `lastRunDay` counts from. Fixed forever — it is packed into a shipped blob. */
const DAY_ZERO_MS = Date.UTC(2020, 0, 1)
const MS_PER_DAY = 86_400_000

/**
 * Days since 2020-01-01, as the `u16` that `explored-lastrun-r10.bin` packs (05 §7.2).
 *
 * Stored rather than derived so the blob builder (`0049`) does not re-parse 150,000 ISO
 * strings on every rebuild. 2020 gives a u16 range reaching 2199, which is not a decision
 * anyone needs to revisit.
 *
 * FLOORED IN UTC, deliberately, and this is the one place in the system where UTC is
 * right: it is a storage encoding of an instant, not a user-facing day. The local-day
 * question — "did I work out today" — is `startedAtLocal`'s and is answered in
 * `persist.ts`'s `userIdLocalDay` (I-13).
 */
export function lastRunDay(iso: string): number {
  return Math.floor((Date.parse(iso) - DAY_ZERO_MS) / MS_PER_DAY)
}

/** Everything the cell writer reads off an activity. Nothing else may influence a cell. */
export interface CellWriteActivity {
  userId: string
  activityId: string
  /**
   * `activity.startedAt`, NEVER `now()`. D-020 and `05-fog-of-war.md` §3: scoring is a
   * function of when the run happened, so a backfill imported today must age its cells
   * from the day it was run. Using the ingest clock here would make every backfilled run
   * look fresh and would silently disarm the six-month re-arm for all of them.
   */
  startedAt: string
}

export interface CellWriteDeps {
  ddb: { send(command: UpdateCommand): Promise<unknown> }
  /** Defaults to `EXPLORED_CELL_TABLE`; overridden only by tests. */
  table?: string
  /**
   * How many `UpdateItem`s are in flight at once. 8 puts a 130-cell run at ~17 round
   * trips, well inside the worker's 900 s budget, and stays far below anything
   * on-demand capacity would throttle for a single user.
   */
  concurrency?: number
  /** Retry attempts per cell on a throttling error. Not on a conditional failure. */
  maxRetries?: number
  /** Injected so the backoff is instant in tests. */
  sleep?(ms: number): Promise<void>
}

/**
 * THE PRIMARY WRITE. `02-data-model.md` T6's expression, transcribed.
 *
 * The condition is what makes it safe for out-of-order arrival: a backfilled 2024 run
 * cannot stomp a 2026 `lastRunAt`, because the write simply does not apply. When it
 * fails, `firstRunBackfill` is the second, narrower write.
 *
 * `lastRunId` follows `lastRunAt` by construction rather than by a second rule — both are
 * in the same `SET`, under the same condition, so there is no state in which the id names
 * a run that is not the latest.
 */
export function cellUpdate(
  cell: H3Index,
  activity: CellWriteActivity,
  table = EXPLORED_CELL_TABLE,
): UpdateCommandInput {
  return {
    TableName: table,
    Key: cellKey(activity.userId, cell),
    UpdateExpression:
      "SET firstRunAt = if_not_exists(firstRunAt, :at), " +
      "firstRunId = if_not_exists(firstRunId, :rid), " +
      "lastRunAt = :at, lastRunId = :rid, lastRunDay = :day " +
      "ADD visitCount :one, discoveryCount :credit",
    ConditionExpression: "attribute_not_exists(lastRunAt) OR lastRunAt < :at",
    ExpressionAttributeValues: {
      ":at": activity.startedAt,
      ":rid": activity.activityId,
      ":day": lastRunDay(activity.startedAt),
      ":one": 1,
      /**
       * ZERO, ALWAYS, IN THIS TICKET. `discoveryCount` separates "ran here 40 times" from
       * "re-armed twice", and only `0048` can tell those apart. The term is present so the
       * attribute exists from the first write and the row shape never varies — the same
       * reasoning `persist.ts` applies to writing `cellCount: 0` on a treadmill run.
       */
      ":credit": 0,
    },
  }
}

/**
 * THE FALLBACK. Runs only when the primary write's condition failed, and lowers
 * `firstRunAt` without touching the clock. T6: *"a second `UpdateItem` that only lowers
 * `firstRunAt` (`ConditionExpression: firstRunAt > :at`) and leaves the clock alone"*.
 *
 * `visitCount` is incremented here too — the activity did visit the cell, and T6 says
 * `ADD 1` per *activity*. It stays idempotent because replaying the same backfill finds
 * `firstRunAt` already equal and the condition false.
 *
 * ─── THE HOLE THIS LEAVES, STATED RATHER THAN HIDDEN ────────────────────────
 *
 * An activity that lands strictly BETWEEN an existing `firstRunAt` and `lastRunAt` — a
 * 2025 backfill onto a cell already holding 2024 and 2026 — satisfies neither condition
 * and writes nothing, so its visit goes uncounted. That is T6's design, not an oversight
 * in this implementation: `visitCount` is documented as *"most-run ground; a future heat
 * view"*, both timestamps are already correct without it, and `05-fog-of-war.md` §3.4
 * enqueues out-of-order activities for replay, where the fold recomputes every attribute
 * from scratch (§2.9, ticket `0103`). The cheap alternative — an unconditional `ADD` —
 * would trade a cosmetic undercount for a double-count on every redelivery, which is the
 * failure this whole file is shaped to avoid.
 */
export function firstRunBackfill(
  cell: H3Index,
  activity: CellWriteActivity,
  table = EXPLORED_CELL_TABLE,
): UpdateCommandInput {
  return {
    TableName: table,
    Key: cellKey(activity.userId, cell),
    UpdateExpression:
      "SET firstRunAt = :at, firstRunId = :rid ADD visitCount :one, discoveryCount :credit",
    ConditionExpression: "firstRunAt > :at",
    ExpressionAttributeValues: {
      ":at": activity.startedAt,
      ":rid": activity.activityId,
      ":one": 1,
      ":credit": 0,
    },
  }
}

/** What a run's cell writes actually did. Returned for the log line, never for control flow. */
export interface CellWriteResult {
  /** Cells whose primary conditional write applied. */
  advanced: number
  /** Cells where the clock was newer and only `firstRunAt` was lowered. */
  backfilled: number
  /** Cells where both conditions failed — a replay, or an out-of-order middle arrival. */
  unchanged: number
}

const THROTTLE = new Set([
  "ProvisionedThroughputExceededException",
  "ThrottlingException",
  "RequestLimitExceeded",
  "InternalServerError",
])

const isConditionalFailure = (e: unknown): boolean =>
  (e as { name?: string })?.name === "ConditionalCheckFailedException"

const isThrottle = (e: unknown): boolean => THROTTLE.has((e as { name?: string })?.name ?? "")

/**
 * WRITE ONE RUN'S CELLS. Idempotent, unordered, and safe to call twice.
 *
 * **A `ConditionalCheckFailedException` is not an error here.** It is the `min`/`max`
 * working — the whole mechanism is "attempt the write and let DynamoDB decide" — so it
 * routes to the fallback rather than to a `catch`. Treating it as a fault is the mistake
 * that turns an ordinary backfill into a DLQ message.
 *
 * Throttling IS an error, and retried with exponential backoff. On-demand capacity for a
 * single user will not throttle 130 writes, so a retry here is a real incident and the
 * budget is small on purpose.
 *
 * PARTIAL FAILURE THROWS, and the ordering makes that safe: the transaction has not run,
 * the receipt is still `PROCESSING`, and a redelivery re-runs the whole set as no-ops
 * over what already landed. That is exactly the "map ahead of XP" skew — never the
 * reverse — and it is the reason this call goes above `persistActivity` and not below it.
 */
export async function writeCells(
  cells: Iterable<H3Index>,
  activity: CellWriteActivity,
  deps: CellWriteDeps,
): Promise<CellWriteResult> {
  const table = deps.table ?? EXPLORED_CELL_TABLE
  const concurrency = deps.concurrency ?? 8
  const maxRetries = deps.maxRetries ?? 3
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  const queue = [...cells]
  const result: CellWriteResult = { advanced: 0, backfilled: 0, unchanged: 0 }

  async function send(input: UpdateCommandInput): Promise<"applied" | "condition-failed"> {
    for (let attempt = 0; ; attempt++) {
      try {
        await deps.ddb.send(new UpdateCommand(input))
        return "applied"
      } catch (e) {
        if (isConditionalFailure(e)) return "condition-failed"
        if (isThrottle(e) && attempt < maxRetries) {
          await sleep(2 ** attempt * 50)
          continue
        }
        throw e
      }
    }
  }

  async function one(cell: H3Index): Promise<void> {
    if ((await send(cellUpdate(cell, activity, table))) === "applied") {
      result.advanced++
      return
    }
    if ((await send(firstRunBackfill(cell, activity, table))) === "applied") {
      result.backfilled++
      return
    }
    result.unchanged++
  }

  /**
   * A fixed pool of workers pulling from one queue, rather than chunking into slices of
   * `concurrency` and awaiting each slice. Chunking idles the whole batch on its slowest
   * member, which at 130 cells and a tail-latency spike is the difference between one
   * round-trip of delay and sixteen.
   */
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) await one(next)
  })
  await Promise.all(workers)

  return result
}
