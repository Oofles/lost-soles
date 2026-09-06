import { TransactWriteCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb"

import type { Activity } from "@/src/domain/activity"

import { doneTransactItem } from "./ingest-receipt"

/**
 * THE ATOMIC COMMIT. Ticket 0041, `02-data-model.md` T3 and T8 layer 3,
 * `01-architecture.md` §4 step 15.
 *
 * ─── ONE TRANSACTION, AND WHY IT HAS TO BE ──────────────────────────────────
 *
 * §4 layer 3: *"XP and the receipt commit or fail together. There is no window in
 * which XP is awarded and the receipt is not advanced."*
 *
 * That sentence is the whole reason this module exists. Write the `Activity` row and
 * then advance the receipt as two calls, and a crash between them leaves a scored
 * activity whose receipt still says `PROCESSING` — so the next delivery reclaims it
 * as stale and scores the same run again, on an XP ledger that can only ever add
 * (D-135). The duplicate would be permanent and unattributable.
 *
 * At this milestone there is no XP engine (capability 09), so the transaction carries
 * two items. `extraItems` is how the `SkillState` `ADD`s and the `XpLedgerEntry`
 * conditional puts join it later WITHOUT this function being restructured — which
 * matters, because restructuring the atomic commit is exactly the change nobody wants
 * to be making under pressure.
 *
 * ─── WHAT IS DELIBERATELY NOT IN THE TRANSACTION ────────────────────────────
 *
 * CELLS. D-144: a run produces 40–130 cells, and `TransactWriteItems` caps at 100
 * items, so atomicity across both is not available at any price. Since one of the two
 * has to be able to lag, the chosen skew is **map ahead of XP, never the reverse**
 * (I-10):
 *
 *   - Revealed-but-unscored ground SELF-HEALS. The receipt never reached DONE, so a
 *     redelivery re-scores it, and the cell writes are set-inserts that no-op.
 *   - Scored-but-unrevealed ground could only be repaired by re-fogging, and no code
 *     path in this system is allowed to do that (D-020, I-7).
 *
 * So cells are written FIRST, outside and before this call, and this transaction runs
 * after. The ordering obligation is fixed here even though the cell writer itself
 * lands in 0047 — `assertNoCellWrites` below is what keeps it fixed.
 */

/**
 * NO CLOCK HERE, and no receipt table name either — both are absences worth stating.
 *
 * The receipt half of the transaction carries its own table name, because
 * `doneTransactItem` (0040) is the single expression of what a DONE transition is. And
 * every timestamp on the row is derived from the activity itself (see `activityItem`),
 * so this function is reproducible: criterion 2 asks that re-persisting write identical
 * bytes, which a `new Date()` anywhere in here would quietly make impossible.
 */
export interface PersistDeps {
  ddb: { send(command: TransactWriteCommand): Promise<unknown> }
  /**
   * T3's physical table name. Amplify GENERATES it (`Activity-<apiId>-<env>`), so
   * unlike the three CDK tables it cannot be a literal anyone states — the worker is
   * handed it from `backend.data.resources.tables["Activity"].tableName` (0042).
   */
  activityTable: string
}

/**
 * THE AMPLIFY METADATA THIS ROW MUST CARRY. D-207.
 *
 * `Activity` is an AppSync `defineData` model (02 §2.1: five models, three CDK
 * tables), but the pipeline writes its rows as raw DynamoDB items so they can sit in
 * a `TransactWriteItems` with the receipt — an AppSync mutation cannot join a
 * transaction, and layer 3 dies without one.
 *
 * The consequence, which no design document states: **the pipeline is responsible for
 * Amplify's own item conventions.** A row missing `__typename` is returned by AppSync
 * with a null type and the generated client discards it; rows missing `createdAt` /
 * `updatedAt` fail non-null field resolution on read. The row would be present in
 * DynamoDB and invisible in the app — the worst of the available failures, because
 * nothing errors.
 *
 * `owner` is the `allow.owner()` claim and its format is Amplify's, not ours:
 * `<sub>::<username>`, which for this pool are the same value. It is what makes the
 * row readable by the one account that owns it and nobody else.
 */
export const AMPLIFY_MODEL_TYPENAME = "Activity"

export function amplifyMetadata(userId: string, ingestedAt: string) {
  return {
    __typename: AMPLIFY_MODEL_TYPENAME,
    owner: `${userId}::${userId}`,
    /**
     * FROM THE ACTIVITY, NOT THE CLOCK. Criterion 2 asks that re-persisting the same
     * activity write identical bytes; a `new Date()` here would make every replay
     * differ in two fields, so a byte comparison could never be the test and
     * "identical" would quietly come to mean "identical apart from the bits that
     * always change". `ingestedAt` is already on the contract and already means the
     * moment this activity entered the system.
     */
    createdAt: ingestedAt,
    updatedAt: ingestedAt,
  }
}

/**
 * `<userId>#<YYYY-MM-DD>` from the LOCAL wall clock, never from UTC (I-13, conflict #3).
 *
 * This is the whole reason `startedAtLocal` exists as a separate field. A 9pm run on
 * the 5th in Denver is `2026-09-06T03:00:00Z` — deriving the day from UTC files it
 * under the 6th, so "did I work out today" answers wrongly for every evening workout
 * west of Greenwich, and every streak built on it is wrong in the same direction.
 *
 * A plain `slice(0, 10)` because `startedAtLocal` is a naive wall clock with no offset
 * and no `Z`: parsing it into a `Date` would attach the RUNTIME's timezone, which in
 * Lambda is UTC, reintroducing the exact bug this field exists to prevent.
 */
export function userIdLocalDay(userId: string, startedAtLocal: string): string {
  return `${userId}#${startedAtLocal.slice(0, 10)}`
}

/**
 * T3 stored flat: the contract's `Activity`, plus the derived and game-layer fields.
 *
 * PURE — a total function of the activity, with no clock and no randomness. That is
 * what makes criterion 2's "re-persisting writes identical bytes" a property a test
 * can actually assert rather than a hope.
 */
export function activityItem(activity: Activity): Record<string, unknown> {
  return {
    ...amplifyMetadata(activity.userId, activity.ingestedAt),

    /** THE DETERMINISTIC ID (I-5). Re-persisting the same activity is a no-op by key. */
    id: activity.activityId,
    userId: activity.userId,
    kind: activity.kind,

    /** All three time fields (I-13). An offset is not a timezone. */
    startedAt: activity.startedAt,
    startedAtLocal: activity.startedAtLocal,
    timezone: activity.timezone,
    userIdLocalDay: userIdLocalDay(activity.userId, activity.startedAtLocal),

    elapsedS: activity.elapsedS,
    movingS: activity.movingS,
    distanceM: activity.distanceM,
    elevationGainM: activity.elevationGainM,
    name: activity.name,

    source: activity.source,
    raw: activity.raw,
    /** Null is a NORMAL outcome here: treadmill, manual, strength. */
    traceRef: activity.traceRef,
    hasTrace: activity.hasTrace,
    sets: activity.sets,

    dedupeKey: activity.dedupeKey,
    ingestedAt: activity.ingestedAt,
    revision: activity.revision,

    /**
     * The game layer, WRITTEN EVEN WHEN ZERO (05 §8.2, §7.2). A treadmill run has no
     * cells, and it still carries `cellCount: 0` — so a reader never has to know which
     * era wrote a row, and "absent" never has to be distinguished from "none".
     *
     * `xpAwarded` is 0 here because capability 09 does not exist yet. It is written
     * rather than omitted for the same reason: the row shape must not vary.
     */
    xpAwarded: 0,
    cellCount: 0,
    newCellCount: 0,
    rearmedCellCount: 0,
    cooledCellCount: 0,
    cellsRef: null,

    /** ACTIVE | TOMBSTONED. A source-side delete tombstones; cells are never removed. */
    status: "ACTIVE",
  }
}

/**
 * T6's key shape (`02-data-model.md`), named here so the guard below can recognise one.
 * `PK: U#<uid>#C#<res6parent>` — nothing else in this system uses that prefix.
 */
const CELL_KEY_PREFIX = /^U#.+#C#/

/**
 * I-10, ASSERTED RATHER THAN DOCUMENTED. Throws if any item in the transaction looks
 * like a cell write.
 *
 * This exists because the failure it prevents is invisible and permanent. Adding cells
 * to this transaction would work for every activity under 98 cells and then start
 * failing — silently, at the 100-item cap, on exactly the long runs that reveal the
 * most ground. And the repair for scored-but-unrevealed ground is re-fogging, which
 * D-020 forbids outright.
 *
 * A comment saying "do not add cells here" would not have stopped that. This does.
 */
export function assertNoCellWrites(
  items: NonNullable<TransactWriteCommandInput["TransactItems"]>,
): void {
  for (const item of items) {
    const key = (item.Put?.Item ?? item.Update?.Key ?? item.Delete?.Key) as
      | Record<string, unknown>
      | undefined
    const pk = key?.PK ?? key?.pk
    if (typeof pk === "string" && CELL_KEY_PREFIX.test(pk)) {
      throw new Error(
        "I-10: cell writes must not join the ingest transaction (D-144). " +
          "Cells are written first, outside it — see src/pipeline/persist.ts.",
      )
    }
  }
}

/**
 * Writes the activity and closes the receipt, atomically.
 *
 * `extraItems` is capability 09's seam and it is checked by the same guard: a ledger
 * row is welcome, a cell write is not, and the caller does not get to decide which.
 *
 * ON FAILURE NOTHING IS WRITTEN — that is what `TransactWriteItems` means, and it is
 * why this function does no cleanup. The receipt stays `PROCESSING`, which the score
 * gate's stale clause reclaims on the next delivery, and there is no partial
 * `Activity` row to find because the transaction never applied one.
 */
export async function persistActivity(
  activity: Activity,
  receipt: { ingestKey: string; xpAwarded?: number; newCellCount?: number },
  deps: PersistDeps,
  extraItems: NonNullable<TransactWriteCommandInput["TransactItems"]> = [],
): Promise<void> {
  const items: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
    {
      Put: {
        TableName: deps.activityTable,
        Item: activityItem(activity),
      },
    },
    /**
     * The receipt half comes from `ingest-receipt.ts` as a descriptor, guarded on
     * `status = "PROCESSING"`. Built there rather than here so there is exactly one
     * expression of what a DONE transition is (0040).
     */
    doneTransactItem({
      ingestKey: receipt.ingestKey,
      xpAwarded: receipt.xpAwarded ?? 0,
      newCellCount: receipt.newCellCount ?? 0,
    }),
    ...extraItems,
  ]

  assertNoCellWrites(items)

  await deps.ddb.send(new TransactWriteCommand({ TransactItems: items }))
}
