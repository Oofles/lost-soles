import { UpdateCommand, type UpdateCommandInput } from "@aws-sdk/lib-dynamodb"

import { EXPLORED_CELL_TABLE } from "./explored-cells"

/**
 * THE GENERATION COUNTER. Ticket `0049`. `05-fog-of-war.md` §7.3; `02-data-model.md`
 * §6.4, §8.3 step 7; **I-11**.
 *
 * ─── WHAT I-11 ACTUALLY DEMANDS ─────────────────────────────────────────────
 *
 * *"`manifest.generation` is monotonic per user — it never decreases and never restarts
 * at 1, including after a full rebuild."* The failure it prevents is specific and nasty:
 * a generation that goes backwards leaves **every cached client convinced it is already
 * current**, so the fog appears to regress on exactly the devices that were working
 * correctly. There is no error, no retry and no way for the client to notice.
 *
 * ─── WHY A COUNTER ITEM, WHEN THE MANIFEST IS AUTHORITATIVE ─────────────────
 *
 * `05` §7.3 says the counter is *"bumped by the ingest Lambda inside the same transaction
 * as the cell writes"*. **There is no such transaction.** D-144/I-10 moved cell writes out
 * of `TransactWriteItems` entirely — a run produces 40–130 cells against a 100-item cap —
 * so that sentence describes a mechanism the system no longer has. Same shape of staleness
 * as AP-15, corrected by `0048`. See D-218.
 *
 * The obvious replacement — read `manifest.generation`, add one — is **not safe**, and not
 * theoretically: the ingest queue is a standard SQS queue with `batchSize: 1` and no
 * reserved concurrency, so a Sync that pulls five new activities runs five workers for one
 * user at once. Two of them read generation 41 and both write `explored-r10.42.bin`, two
 * different cell sets under one name, served `Cache-Control: immutable`. Nothing anywhere
 * can recover from that, because "immutable" is a promise the CDN and the browser have
 * already believed.
 *
 * So the number is allocated by an ATOMIC counter and the manifest records what was
 * allocated. The manifest stays authoritative for *what the client should fetch* (`02`
 * §6.4, and `Profile.exploredGeneration` stays the mirror `0051` repairs); this item is
 * authoritative for *which numbers have ever been handed out*, which is a different
 * question and the one immutability turns on.
 *
 * ─── A THIRD ITEM TYPE IN T6, WHICH `02` CALLS A TABLE OF TWO ───────────────
 *
 * `02` T6: *"Two item types share this table. That is a deliberate, bounded exception to
 * §2.1."* This is a third, and it is added here rather than in a table of its own for the
 * reasons that made the exception bounded in the first place: it is written by the same
 * job, on the same path, under the same partition-key convention, and it belongs to the
 * one table in the system carrying `RETAIN` and point-in-time recovery — which is exactly
 * the durability a counter that must never go backwards wants. A ninth table for a single
 * number would be the laziness §2.1 is defending against, inverted.
 *
 * `02` T6 was amended in the same commit. D-153: the code changes or the doc changes.
 */

/**
 * `U#<uid>#GEN` / `GEN`. One item per user, forever.
 *
 * The `#GEN` suffix keeps it out of both existing key spaces by construction: a cell
 * partition is `U#<uid>#C#<res6parent>` and an aggregate is `U#<uid>#AGG#<res>`, so no
 * `Query` written for either can return this item, and `persist.ts`'s `assertNoCellWrites`
 * — which recognises a cell write by the `#C#` infix — is unaffected.
 */
export function generationKey(userId: string): { pk: string; sk: string } {
  return { pk: `U#${userId}#GEN`, sk: "GEN" }
}

export interface GenerationDeps {
  ddb: { send(command: UpdateCommand): Promise<{ Attributes?: Record<string, unknown> }> }
  table?: string
}

/**
 * ALLOCATE THE NEXT GENERATION. `ADD generation :one`, returning the new value.
 *
 * Monotonic **by construction, not by condition**: `ADD` on a number is an atomic
 * increment performed inside DynamoDB, so there is no read for a concurrent writer to
 * race against and no value this function could be handed that would lower the counter.
 * Two simultaneous callers get 42 and 43 — never 42 twice.
 *
 * `ADD` on a missing attribute treats it as 0, so a user's first ever call returns 1 with
 * no bootstrap step and no "does the item exist" read. That is also why this module needs
 * no `GetItem` grant: nothing ever reads the counter back. The previous generation comes
 * from `manifest.json`, which is where `02` §6.4 says authority lives.
 *
 * **A burned number is a normal outcome.** If the worker dies between this call and the
 * manifest PUT, generation 42 is allocated and never published. `02` §6.4 already accounts
 * for it — *"a crash before it leaves orphan blobs (harmless, garbage-collected)"* — and
 * the alternative, allocating late enough to never waste one, is precisely the
 * read-modify-write this exists to avoid.
 */
export async function bumpGeneration(userId: string, deps: GenerationDeps): Promise<number> {
  const out = await deps.ddb.send(
    new UpdateCommand({
      TableName: deps.table ?? EXPLORED_CELL_TABLE,
      Key: generationKey(userId),
      UpdateExpression: "ADD generation :one",
      ExpressionAttributeValues: { ":one": 1 },
      ReturnValues: "UPDATED_NEW",
    }),
  )

  const next = out.Attributes?.generation
  if (typeof next !== "number" || !Number.isInteger(next) || next < 1) {
    throw new Error(
      `bumpGeneration: T6 returned ${JSON.stringify(next)} for ${userId}. A generation that ` +
        "is not a positive integer cannot name an immutable object (I-11).",
    )
  }
  return next
}

/**
 * RAISE THE FLOOR. `02` §8.3 step 7: *"Set `generation` = the step-0 generation + 1, never
 * 1."*
 *
 * The rebuild drill rebuilds into **new, empty tables**, so the counter it finds there is
 * absent and the next `bumpGeneration` would return 1 — every client cached at generation
 * 412 would then see 1, conclude it is ahead, and never fetch the rebuilt map again. This
 * is the one operation that repairs that, and it is why the drill's step 0 records the
 * pre-drill generation before anything else happens.
 *
 * **Conditional, and it refuses to lower.** The condition is the executable form of I-11:
 * called with a value at or below what the counter already holds, it writes nothing and
 * returns `false`. That makes "attempt to lower it" a test rather than a review comment.
 *
 * Not called on the ingest path. It exists for the drill (`0105`) and the consistency
 * check, and it is here rather than in a script because `08` §8.4's rule applies —
 * a recovery path that has never been executed is not a recovery path, and code in a
 * module has tests.
 */
export async function raiseGenerationTo(
  userId: string,
  generation: number,
  deps: GenerationDeps,
): Promise<boolean> {
  if (!Number.isInteger(generation) || generation < 1) {
    throw new RangeError(`raiseGenerationTo: ${generation} is not a positive integer`)
  }

  const input: UpdateCommandInput = {
    TableName: deps.table ?? EXPLORED_CELL_TABLE,
    Key: generationKey(userId),
    UpdateExpression: "SET generation = :n",
    ConditionExpression: "attribute_not_exists(generation) OR generation < :n",
    ExpressionAttributeValues: { ":n": generation },
  }

  try {
    await deps.ddb.send(new UpdateCommand(input))
    return true
  } catch (e) {
    // A refused write is the invariant holding, not a fault. The caller decides whether
    // "already at or above that" is a problem; for the drill it is a passing assertion.
    if ((e as { name?: string })?.name === "ConditionalCheckFailedException") return false
    throw e
  }
}
