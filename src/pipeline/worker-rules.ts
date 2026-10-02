import { GetCommand, type QueryCommand } from "@aws-sdk/lib-dynamodb"

import { readShownRows } from "@/src/pipeline/skillstate-snapshot"
import type { RuleSet } from "@/src/rules/schema"

/**
 * WHICH RULESET THE INGEST WORKER SCORES A USER UNDER. Ticket `0234`, D-274.
 *
 * The answer is **the version the user's ledger was last computed under**: the highest
 * `rulesVersionLastComputed` on their T2 rows. A replay to v*N* rewrites every one of those rows
 * to *N* at its thaw (`xp-replay.ts` step 6), and every ingest commit writes the version it
 * scored under to the rows it touched, so the two writers agree and nothing else ever sets it.
 * This is the same reading `replayUser` already takes for its own `fromVersion`, and it lives
 * here so the replay and the worker cannot come to disagree about what "the user's version" is.
 *
 * WHY NOT A DEPLOY-TIME CONSTANT. A constant moves at deploy, the ledger moves at replay, and
 * the two can never happen at the same instant, so every activity ingested between them would
 * be scored under a version the ledger is not on. Reading it from the ledger means a deploy
 * only makes v*N* *available*; the replay is what switches the user to it.
 *
 * A USER WITH NO T2 ROWS falls back to `Profile.ledgerRulesVersion`, which the replay's thaw
 * stamps (`0235`, D-275). A replay that produced no XP leaves no T2 rows but does leave the
 * stamp, and the ingest commit is conditioned on it — scoring such a user under "the newest
 * bundled" would be refused on every redelivery once a newer version shipped. Only a user with
 * neither — never scored, never replayed — has nothing to be consistent with, and is scored
 * under the newest bundled version.
 */

/** What the pipeline needs from a ruleset. Matches `ProcessDeps.registry`. */
export type Registry = Pick<RuleSet, "version" | "skills" | "curve">

/** The user's ledger is on a version this deployment does not carry. */
export class RulesVersionNotBundledError extends Error {
  constructor(
    readonly userId: string,
    readonly version: number,
    readonly bundled: readonly number[],
  ) {
    super(
      `${userId}'s ledger is on xp-rules v${version}, and this worker bundles only ` +
        `v${bundled.join(", v")}. Deploy the ruleset before replaying to it (02 §4.4). Refusing ` +
        "rather than scoring under another version, which the next replay would silently re-price.",
    )
    this.name = "RulesVersionNotBundledError"
  }
}

/**
 * The version a user's ledger is on, or `undefined` when they have no T2 rows (or none that
 * records one). The MAX, because during a replay's thaw rows can briefly disagree, and the
 * replay is always moving them to the version it wrote last.
 */
export function ledgerRulesVersion(
  states: readonly { rulesVersionLastComputed?: number }[],
): number | undefined {
  const versions = states
    .map((s) => s.rulesVersionLastComputed)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
  return versions.length > 0 ? Math.max(...versions) : undefined
}

/** The bundled ruleset for `version`, or the newest one when `version` is `undefined`. */
export function pickBundledRules<R extends Registry>(
  userId: string,
  version: number | undefined,
  bundled: ReadonlyMap<number, R>,
): R {
  const have = [...bundled.keys()].sort((a, b) => a - b)
  if (have.length === 0) throw new Error("pickBundledRules: no ruleset is bundled at all")
  const want = version ?? have[have.length - 1]
  const rules = bundled.get(want)
  if (!rules) throw new RulesVersionNotBundledError(userId, want, have)
  return rules
}

/**
 * The I/O half: one consistent query of the user's T2 partition; only when that yields no
 * version, one consistent read of their T1 row (`0235`); then `pickBundledRules`.
 */
export async function rulesForUser<R extends Registry>(
  userId: string,
  deps: {
    ddb: { send(command: QueryCommand | GetCommand): Promise<unknown> }
    table: string
    /** T1 `Profile`, for the fallback. */
    profileTable: string
    bundled: ReadonlyMap<number, R>
  },
): Promise<R> {
  const rows = await readShownRows(userId, { ddb: deps.ddb, table: deps.table })
  const states = rows.map((r) => ({ rulesVersionLastComputed: numberOrUndefined(r.rulesVersionLastComputed) }))
  const version = ledgerRulesVersion(states) ?? (await profileRulesVersion(userId, deps))
  return pickBundledRules(userId, version, deps.bundled)
}

/** `Profile.ledgerRulesVersion`, or `undefined` when the row or the attribute is absent. */
async function profileRulesVersion(
  userId: string,
  deps: { ddb: { send(command: GetCommand): Promise<unknown> }; profileTable: string },
): Promise<number | undefined> {
  const out = (await deps.ddb.send(
    new GetCommand({
      TableName: deps.profileTable,
      Key: { id: userId },
      ProjectionExpression: "ledgerRulesVersion",
      ConsistentRead: true,
    }),
  )) as { Item?: Record<string, unknown> }
  return numberOrUndefined(out.Item?.ledgerRulesVersion)
}

function numberOrUndefined(v: unknown): number | undefined {
  return v === undefined || v === null ? undefined : Number(v)
}
