import { QueryCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb"

import type { Activity } from "@/src/domain/activity"
import type { DiscoveryAward } from "@/src/domain/discovery"
import type { TraceRejects } from "@/src/domain/fog"
import { sumXp, xpBySkill, type XpLedgerEntry } from "@/src/scoring/ledger"

import { amplifyMetadata, persistActivity, type PersistDeps } from "./persist"

/**
 * THE LEDGER'S WRITE PATH. Ticket 0062. `02-data-model.md` §4.3, T2, T4; I-15, D-142.
 *
 * The ledger rows, the `SkillState` `ADD`s, the `Activity` put and the receipt's `DONE` ride in
 * ONE `TransactWriteItems` (`persistActivity`). XP and its receipt commit or fail together.
 *
 * ─── TWO IDEMPOTENCY LAYERS, AND WHY THE ROW ID ALONE IS NOT ENOUGH ─────────
 *
 * The row `id` is `activity#skill#reason#vN`, and every put is `attribute_not_exists(id)`. That
 * stops a CONCURRENT duplicate: the loser's transaction cancels, and the retry below sees the
 * winner's rows.
 *
 * It does not stop a LATER duplicate. A redelivery after the 90-day receipt TTL, or a `reingest`
 * (`0192`), re-runs the cells first, and the cells now carry this activity's own `lastRunAt`. So
 * every cell classifies `cooled`, the ground split comes back 100% `recent_ground`, and the ids
 * are DIFFERENT from the first delivery's `new_ground` ids. The condition passes and half the
 * XP is paid a second time, permanently (D-135). The reasoning in `ingest-receipt.ts`, "`newCells
 * \ explored` is empty on a replay", holds for cells and not for XP, because recent ground
 * still pays (D-120). D-254.
 *
 * So the first layer is per ACTIVITY: before building rows, `existingEntries` asks GSI1
 * `byActivity` whether this activity has any rule-derived row, under ANY ruleset version. If it
 * has, this delivery awards nothing, and the `Activity` row carries the existing sum. A version
 * change goes through the replay job (`0066`), which deletes and rewrites; ingest never layers a
 * second version on top of the first.
 */

export interface LedgerDeps {
  ddb: { send(command: QueryCommand): Promise<unknown> }
  /** T4's physical name. Amplify generates it; the worker is handed it in the environment. */
  ledgerTable: string
  /** T2's physical name, likewise. */
  skillStateTable: string
}

export const LEDGER_TYPENAME = "XpLedgerEntry"
export const SKILL_STATE_TYPENAME = "SkillState"
/** T4 GSI1. The name `amplify/data/resource.ts` gives it. */
export const BY_ACTIVITY_INDEX = "byActivity"

/** How many times a lost `xpLedgerSum` race re-reads and retries (§4.3). */
export const MAX_LEDGER_ATTEMPTS = 3

type TransactItems = NonNullable<TransactWriteCommandInput["TransactItems"]>

/** The slice of T2 the ADD needs to read first. */
export interface SkillStateRow {
  skillId: string
  xpLedgerSum: number
  firstXpAt?: string
  lastXpAt?: string
}

async function queryAll(
  deps: LedgerDeps,
  input: ConstructorParameters<typeof QueryCommand>[0],
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = []
  let ExclusiveStartKey: Record<string, unknown> | undefined
  do {
    const page = (await deps.ddb.send(new QueryCommand({ ...input, ExclusiveStartKey }))) as {
      Items?: Record<string, unknown>[]
      LastEvaluatedKey?: Record<string, unknown>
    }
    items.push(...(page.Items ?? []))
    ExclusiveStartKey = page.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return items
}

/**
 * This activity's rule-derived rows already in T4, any version. Layer 1 above.
 *
 * GSI reads are eventually consistent. That is acceptable here because the case this guards is
 * a LATER delivery, seconds to months after the first commit. The concurrent case is the row
 * condition's job, and a transaction does not depend on this read being fresh.
 */
export async function existingEntries(
  activityId: string,
  deps: LedgerDeps,
): Promise<Pick<XpLedgerEntry, "id" | "xpAwarded" | "xpRulesVersion">[]> {
  const items = await queryAll(deps, {
    TableName: deps.ledgerTable,
    IndexName: BY_ACTIVITY_INDEX,
    KeyConditionExpression: "activityId = :a",
    FilterExpression: "isFloor = :f",
    ExpressionAttributeValues: { ":a": activityId, ":f": false },
  })
  return items.map((i) => ({
    id: String(i.id),
    xpAwarded: Number(i.xpAwarded),
    xpRulesVersion: Number(i.xpRulesVersion),
  }))
}

/**
 * Every `SkillState` row for this user, strongly consistent. The base-table query T2 names; at
 * most a few dozen items. The values read here are what the condition on each ADD compares.
 */
export async function readSkillStates(
  userId: string,
  deps: LedgerDeps,
): Promise<Map<string, SkillStateRow>> {
  const items = await queryAll(deps, {
    TableName: deps.skillStateTable,
    KeyConditionExpression: "userId = :u",
    ExpressionAttributeValues: { ":u": userId },
    ConsistentRead: true,
  })
  return new Map(
    items.map((i) => [
      String(i.skillId),
      {
        skillId: String(i.skillId),
        xpLedgerSum: Number(i.xpLedgerSum ?? 0),
        firstXpAt: i.firstXpAt as string | undefined,
        lastXpAt: i.lastXpAt as string | undefined,
      },
    ]),
  )
}

/** One conditional put for a new ledger row. The Amplify metadata makes it readable (D-207). */
export function ledgerPutItem(entry: XpLedgerEntry, table: string): TransactItems[number] {
  return {
    Put: {
      TableName: table,
      Item: {
        ...amplifyMetadata(entry.userId, entry.awardedAt, LEDGER_TYPENAME),
        ...entry,
        /** The two derived index keys T4 names (`amplify/data/resource.ts`). */
        skillIdReason: `${entry.skillId}#${entry.reason}`,
        userIdSkillId: `${entry.userId}#${entry.skillId}`,
      },
      ConditionExpression: "attribute_not_exists(id)",
    },
  }
}

/**
 * One `SkillState` ADD (§4.3). `xpLedgerSum` and `displayedXp` move by the same amount in the
 * same expression. They are two attributes so a bug in one shows against the other (I-15).
 *
 * GUARDED ON THE PRE-READ `xpLedgerSum`: absent if there was no row, equal to what was read if
 * there was. The ADD itself is safe under concurrency. The guard exists because the SET half
 * (`firstXpAt`/`lastXpAt` now, `level`/`levelHighWater` later) is computed from the pre-read,
 * and without it a lost race would be a silent lost update.
 *
 * `firstXpAt`/`lastXpAt` come from `activity.startedAt`, never the clock (I-12), as a `min` and
 * a `max` so a backfilled older run cannot move `lastXpAt` backwards.
 */
export function skillStateUpdateItem(
  args: {
    userId: string
    skillId: string
    xp: number
    prev: SkillStateRow | undefined
    startedAt: string
    ingestedAt: string
    rulesVersion: number
  },
  table: string,
): TransactItems[number] {
  const { userId, skillId, xp, prev, startedAt, ingestedAt, rulesVersion } = args
  const meta = amplifyMetadata(userId, ingestedAt, SKILL_STATE_TYPENAME)
  const firstXpAt = prev?.firstXpAt && prev.firstXpAt < startedAt ? prev.firstXpAt : startedAt
  const lastXpAt = prev?.lastXpAt && prev.lastXpAt > startedAt ? prev.lastXpAt : startedAt

  return {
    Update: {
      TableName: table,
      Key: { userId, skillId },
      UpdateExpression:
        "SET #tn = :tn, #owner = :owner, createdAt = if_not_exists(createdAt, :now), " +
        "updatedAt = :now, firstXpAt = :first, lastXpAt = :last, rulesVersionLastComputed = :ver " +
        "ADD xpLedgerSum :xp, displayedXp :xp",
      ConditionExpression:
        prev === undefined ? "attribute_not_exists(xpLedgerSum)" : "xpLedgerSum = :prev",
      ExpressionAttributeNames: { "#tn": "__typename", "#owner": "owner" },
      ExpressionAttributeValues: {
        ":tn": meta.__typename,
        ":owner": meta.owner,
        ":now": meta.updatedAt,
        ":first": firstXpAt,
        ":last": lastXpAt,
        ":ver": rulesVersion,
        ":xp": xp,
        ...(prev === undefined ? {} : { ":prev": prev.xpLedgerSum }),
      },
    },
  }
}

/** Every item this activity's XP adds to the transaction: the rows, then one ADD per skill. */
export function ledgerTransactItems(
  entries: readonly XpLedgerEntry[],
  states: ReadonlyMap<string, SkillStateRow>,
  activity: Pick<Activity, "userId" | "startedAt" | "ingestedAt">,
  rulesVersion: number,
  deps: Pick<LedgerDeps, "ledgerTable" | "skillStateTable">,
): TransactItems {
  const puts = entries.map((e) => ledgerPutItem(e, deps.ledgerTable))
  const adds = [...xpBySkill(entries)].map(([skillId, xp]) =>
    skillStateUpdateItem(
      {
        userId: activity.userId,
        skillId,
        xp,
        prev: states.get(skillId),
        startedAt: activity.startedAt,
        ingestedAt: activity.ingestedAt,
        rulesVersion,
      },
      deps.skillStateTable,
    ),
  )
  return [...puts, ...adds]
}

/**
 * A `TransactionCanceledException` in which only XP items (index ≥ `firstXpItem`) failed their
 * condition: a concurrent writer moved `xpLedgerSum` or wrote the same row first. Re-read and
 * retry. A failure on the receipt or the `Activity` put is NOT a race to retry: it rethrows.
 */
export function isLostLedgerRace(err: unknown, firstXpItem: number): boolean {
  const e = err as { name?: string; CancellationReasons?: Array<{ Code?: string }> }
  if (e?.name !== "TransactionCanceledException" || !Array.isArray(e.CancellationReasons)) return false
  let sawXpConflict = false
  for (const [i, reason] of e.CancellationReasons.entries()) {
    const code = reason?.Code ?? "None"
    if (code === "None") continue
    if (i < firstXpItem || code !== "ConditionalCheckFailed") return false
    sawXpConflict = true
  }
  return sawXpConflict
}

export interface LedgerCommit {
  /** Σ `xpAwarded` for this activity, whether written now or found already written. */
  xpAwarded: number
  /** Rows this delivery wrote. `0` when `alreadyScored`. */
  rowsWritten: number
  /** A previous delivery wrote this activity's rows (layer 1). */
  alreadyScored: boolean
  /** The ruleset the activity's rows cite, or `null` when it earned nothing. */
  xpRulesVersion: number | null
}

/**
 * THE COMMIT, WITH XP. Wraps `persistActivity` with layer 1, the pre-read, and the §4.3 retry.
 *
 * `persistActivity` puts the `Activity` row first and the receipt second, so XP items start at
 * index 2. That is the index `isLostLedgerRace` is told.
 */
export async function persistWithLedger(
  args: {
    activity: Activity
    ingestKey: string
    entries: readonly XpLedgerEntry[]
    rulesVersion: number
    award: DiscoveryAward
    rejects: TraceRejects | undefined
  },
  deps: { persist: PersistDeps; ledger: LedgerDeps },
): Promise<LedgerCommit> {
  const { activity, ingestKey, entries, rulesVersion, award, rejects } = args
  const FIRST_XP_ITEM = 2

  for (let attempt = 1; ; attempt += 1) {
    const existing = await existingEntries(activity.activityId, deps.ledger)
    const alreadyScored = existing.length > 0

    const commit: LedgerCommit = alreadyScored
      ? {
          xpAwarded: sumXp(existing),
          rowsWritten: 0,
          alreadyScored: true,
          xpRulesVersion: existing[0]!.xpRulesVersion,
        }
      : {
          xpAwarded: sumXp(entries),
          rowsWritten: entries.length,
          alreadyScored: false,
          xpRulesVersion: entries.length > 0 ? rulesVersion : null,
        }

    const items =
      alreadyScored || entries.length === 0
        ? []
        : ledgerTransactItems(
            entries,
            await readSkillStates(activity.userId, deps.ledger),
            activity,
            rulesVersion,
            deps.ledger,
          )

    try {
      await persistActivity(
        activity,
        { ingestKey, xpAwarded: commit.xpAwarded, newCellCount: award.newCellCount },
        deps.persist,
        items,
        award,
        rejects,
        commit.xpRulesVersion,
      )
      return commit
    } catch (err) {
      if (attempt < MAX_LEDGER_ATTEMPTS && isLostLedgerRace(err, FIRST_XP_ITEM)) continue
      throw err
    }
  }
}
