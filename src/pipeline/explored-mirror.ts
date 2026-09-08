import { UpdateCommand } from "@aws-sdk/lib-dynamodb"

/**
 * THE NOTIFICATION CHANNEL, NOT THE SOURCE OF TRUTH. Ticket `0051`.
 * `02-data-model.md` T1, §6.4; `05-fog-of-war.md` §7.4; AP-14.
 *
 * ─── WHAT THIS ATTRIBUTE IS FOR, AND WHAT IT IS NOT ─────────────────────────
 *
 * `02` T1 is unambiguous: `exploredGeneration` is a **mirror** of `manifest.json`'s
 * `generation`, and it *"lives here so the AppSync subscription in 01 §4 step 17 has
 * something to push"*. §6.4 says it again from the other side: **the manifest is
 * authoritative; the Profile attribute is a notification channel. If they ever disagree, the
 * manifest wins and the mirror is repaired.**
 *
 * That is why nothing in this system ever READS the mirror to decide anything. An open tab
 * learns that a run landed because AppSync pushed this number at it, and then goes and reads
 * the manifest. A closed tab learns it from the manifest alone. The mirror being wrong costs
 * a missed push; the manifest being wrong costs the map.
 *
 * ─── SO IT MUST NOT BE ABLE TO FAIL A PUBLISH ───────────────────────────────
 *
 * This runs after the manifest PUT — after the commit point — and every outcome is a value
 * rather than a throw. The receipt is still `PROCESSING` at that moment, so a throw here would
 * send the message back to be redelivered, and the redelivery would allocate a fresh
 * generation and republish a byte-identical map. Forever, on every attempt. A missed push is
 * not worth that, and `05` §7.4 already lists two triggers below the subscription —
 * revalidating the manifest on `visibilitychange`/`focus`, and a manual sync — that do not
 * involve this attribute at all.
 *
 * ─── T1 DOES NOT EXIST YET, AND THAT IS WHY `table` IS OPTIONAL ─────────────
 *
 * `amplify/data/resource.ts` carries `Activity` and `0012`'s placeholder; `Profile` arrives
 * with the XP engine (capability 09), which owns `totalXp`, `totalLevel` and the transaction
 * that writes them. Creating a nine-attribute T1 here to hold one integer would hand two later
 * capabilities a schema they did not choose — the widening D-152 forbids.
 *
 * So this module ships COMPLETE and tested, takes its table as a dependency, and answers
 * `"no-table"` today. The same shape D-217 chose for the ruleset: *"the pipeline takes the
 * registry as an ARGUMENT, so the day T5 exists is one line in the handler."* Here it is one
 * `addEnvironment` call and a grant. See ticket `0182`.
 */

/** What a mirror attempt did. Every value is a normal outcome; none is an error. */
export type MirrorOutcome =
  /** The attribute now equals the generation just published. */
  | "mirrored"
  /** A higher generation is already there — a concurrent publish won. Correct, not a fault. */
  | "stale"
  /** No `Profile` table configured. The state of the world until T1 lands. */
  | "no-table"
  /** The write failed. Logged, never thrown — see the module comment. */
  | "failed"

export interface MirrorDeps {
  ddb: { send(command: UpdateCommand): Promise<unknown> }
  /**
   * T1's physical table name. **Optional on purpose** — `undefined` is not a
   * misconfiguration today, it is the accurate description of a model that does not exist.
   */
  table?: string
}

/**
 * Push `generation` into `Profile.exploredGeneration`, and never lower it.
 *
 * ─── CONDITIONAL, FOR A REASON THE MANIFEST'S CAS DOES NOT COVER ────────────
 *
 * The manifest PUT is serialised by its `IfMatch` (D-219), so publishes commit in order. These
 * mirror writes are NOT serialised with them: worker A can publish 42, be descheduled, and
 * write its mirror after worker B has published 43 and mirrored it. An unconditional `SET`
 * would leave the mirror at 42 with the manifest at 43 — and the subscription would then push
 * a generation the client may already hold, or push nothing at all on the next run because 43
 * looks like an advance from 42 that already happened.
 *
 * `exploredGeneration < :g` makes the mirror monotonic on its own terms, the same shape as
 * every other clock in this subsystem (I-8, I-11). A refusal means a newer publish got there
 * first, which is the mirror being RIGHT.
 *
 * The row is created if absent (`attribute_not_exists`), because an ingest can precede the
 * first Profile write.
 */
export async function mirrorGeneration(
  userId: string,
  generation: number,
  deps: MirrorDeps | undefined,
): Promise<MirrorOutcome> {
  if (deps?.table === undefined) return "no-table"

  try {
    await deps.ddb.send(
      new UpdateCommand({
        TableName: deps.table,
        Key: { id: userId },
        UpdateExpression: "SET exploredGeneration = :g",
        ConditionExpression:
          "attribute_not_exists(exploredGeneration) OR exploredGeneration < :g",
        ExpressionAttributeValues: { ":g": generation },
      }),
    )
    return "mirrored"
  } catch (e) {
    if ((e as { name?: string })?.name === "ConditionalCheckFailedException") return "stale"
    return "failed"
  }
}

/** What a repair found and did. `manifest` is the authoritative number (`02` §6.4). */
export interface MirrorRepair {
  manifest: number
  outcome: MirrorOutcome
}

/**
 * THE REPAIR PATH. `02` §6.4: *"If they ever disagree, the manifest wins and the mirror is
 * repaired — which is why T1 documents it as a mirror rather than a source."*
 *
 * Deliberately takes the authoritative generation as an ARGUMENT rather than reading the
 * manifest itself. Two reasons, and the second is the important one:
 *
 *   - it keeps this module free of S3, so it stays testable with one fake; and
 *   - **the direction of authority becomes impossible to write backwards.** A repair that read
 *     both sides and reconciled them would have a branch in which the Profile wins. There is
 *     no such branch here, because the Profile's value is never read at all — the conditional
 *     write is the entire comparison, performed by DynamoDB.
 *
 * Idempotent: run against an already-correct mirror it reports `"stale"` and writes nothing.
 */
export async function repairGenerationMirror(
  userId: string,
  manifestGeneration: number,
  deps: MirrorDeps | undefined,
): Promise<MirrorRepair> {
  return {
    manifest: manifestGeneration,
    outcome: await mirrorGeneration(userId, manifestGeneration, deps),
  }
}
