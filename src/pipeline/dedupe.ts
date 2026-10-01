import { PutObjectCommand } from "@aws-sdk/client-s3"
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb"

import { isPreconditionFailed } from "@/src/pipeline/archive"
import type { Activity, SourceId } from "@/src/domain/activity"
import { dedupeCandidateKeys, isSameActivity, type DedupeCandidate } from "@/src/domain/dedupe-key"

/**
 * PIPELINE STEP 3 — THE CROSS-SOURCE DEDUPE LOOKUP. Ticket `0179`, contract §3, I-22, D-211.
 *
 * `activityId` is `sha256(userId:source:externalId)`, so one source delivering a run three
 * times is one activity for free. Two sources delivering it — a watch through Strava and the
 * phone through Health Connect — are two ids, and without this step two awards and doubled
 * cell visits on a map that never re-fogs (D-020) and a ledger that can only add (D-135).
 *
 * ─── WHAT IT ASKS ────────────────────────────────────────────────────────────
 *
 * GSI2 `byUserAndDedupe` for each of `dedupeCandidateKeys` (one or two), then a `GetItem` per
 * row for the three fields `isSameActivity` compares — GSI2 is `KEYS_ONLY` on purpose (T3), and
 * the candidate set is 0–2 rows at one user's volume. Both functions are `dedupe-key.ts`'s and
 * are called, never restated: two implementations of a cross-source key agree right up until
 * the day they matter.
 *
 * ─── WHO WINS: THE ONE ALREADY SCORED (D-263) ────────────────────────────────
 *
 * §2.7 originally said the higher-fidelity trace wins. It cannot, once one side is committed:
 * that side's XP is a floor (D-135) and its cells are revealed for good (D-020), so making a
 * later arrival the winner would mean un-awarding the first — which nothing may do. The row
 * found here is therefore always the winner and the activity being ingested always the loser.
 *
 * ─── ITS OWN ROW IS NOT A DUPLICATE ──────────────────────────────────────────
 *
 * A `reingest` (`0192`) or a redelivery re-runs this step for an activity that may already have
 * its T3 row, and that row matches itself perfectly. It is skipped by id, which is the one
 * comparison that cannot be fooled: the same source and external id always hash to it.
 *
 * ─── THE RACE IT DOES NOT CLOSE ─────────────────────────────────────────────
 *
 * A GSI read is eventually consistent, so two sources delivering one run within about a second
 * of each other can each miss the other. At one user's volume, with two sources that sync on
 * their own schedules, that is not worth a lock; it is stated so nobody later reads I-22 as
 * stronger than it is.
 */

/** The index name, stated in `amplify/data/resource.ts` as well. A test asserts they agree. */
export const DEDUPE_INDEX = "byUserAndDedupe"

export interface DedupeDeps {
  ddb: { send(command: QueryCommand | GetCommand): Promise<unknown> }
  /** T3's generated name — the same one `persist.activityTable` is handed. */
  activityTable: string
}

/** The existing activity this one duplicates, or `null`. */
export async function findDuplicate(
  activity: Pick<Activity, "activityId" | "userId" | "startedAt" | "elapsedS" | "distanceM">,
  deps: DedupeDeps,
): Promise<{ activityId: string } | null> {
  const self: DedupeCandidate = candidateOf(activity)
  const seen = new Set<string>([activity.activityId])

  for (const key of dedupeCandidateKeys(activity.userId, self.startedAtMs)) {
    const queried = (await deps.ddb.send(
      new QueryCommand({
        TableName: deps.activityTable,
        IndexName: DEDUPE_INDEX,
        KeyConditionExpression: "userId = :userId AND dedupeKey = :key",
        ExpressionAttributeValues: { ":userId": activity.userId, ":key": key },
      }),
    )) as { Items?: Array<{ id?: string }> }

    for (const { id } of queried.Items ?? []) {
      if (!id || seen.has(id)) continue
      seen.add(id)
      const got = (await deps.ddb.send(
        new GetCommand({
          TableName: deps.activityTable,
          Key: { id },
          ProjectionExpression: "startedAt, elapsedS, distanceM",
        }),
      )) as { Item?: { startedAt: string; elapsedS: number; distanceM?: number | null } }
      // Gone between the index read and this one: nothing to be a duplicate of.
      if (!got.Item) continue
      if (isSameActivity(self, candidateOf(got.Item))) return { activityId: id }
    }
  }
  return null
}

const candidateOf = (row: { startedAt: string; elapsedS: number; distanceM?: number | null }): DedupeCandidate => ({
  startedAtMs: Date.parse(row.startedAt),
  elapsedS: row.elapsedS,
  // T3 may hold `null` where the domain type says absent; both abstain (`isSameActivity`).
  distanceM: row.distanceM ?? undefined,
})

/**
 * THE `duplicateOf` POINTER, BESIDE THE LOSER'S RAW ARCHIVE. §2.7: "record the loser as a
 * `duplicateOf` pointer so the archive stays complete."
 *
 * `raw/<uid>/<source>/<externalId>.duplicate-of.json` — a SIBLING of the activity's archive
 * prefix, never inside it. `replay.ts` lists `raw/<uid>/<source>/<externalId>/` and takes the
 * newest object as the payload, so a pointer filed inside would be replayed as the run.
 *
 * In the archive rather than on the receipt because the receipt expires in 90 days and this
 * must not: the rebuild drill's step 8 check 2 reconciles activity count against raw object
 * count minus known collisions (`02` §1898), and it can only subtract what is still recorded.
 * Under `raw/*` it inherits I-3 — immutable, undeletable — which is right for a fact about the
 * archive. A redelivery writes identical bytes, so the `If-None-Match` refusal is success.
 */
export function duplicatePointerKey(input: { userId: string; source: SourceId; externalId: string }): string {
  return `raw/${input.userId}/${input.source}/${input.externalId}.duplicate-of.json`
}

export interface DuplicatePointerDeps {
  s3: { send(command: PutObjectCommand): Promise<unknown> }
  bucket: string
}

export async function recordDuplicatePointer(
  loser: { userId: string; source: SourceId; externalId: string; activityId: string },
  winner: { activityId: string },
  deps: DuplicatePointerDeps,
  now: Date,
): Promise<string> {
  const key = duplicatePointerKey(loser)
  try {
    await deps.s3.send(
      new PutObjectCommand({
        Bucket: deps.bucket,
        Key: key,
        ContentType: "application/json",
        IfNoneMatch: "*",
        Body: JSON.stringify({
          duplicateOf: winner.activityId,
          activityId: loser.activityId,
          source: loser.source,
          externalId: loser.externalId,
          recordedAt: now.toISOString(),
        }),
      }),
    )
  } catch (error) {
    if (!isPreconditionFailed(error)) throw error
  }
  return key
}
