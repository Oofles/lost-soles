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
 * A USER WITH NO T2 ROWS has nothing to be consistent with and is scored under the newest
 * bundled version.
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

/** The I/O half: one consistent query of the user's T2 partition, then `pickBundledRules`. */
export async function rulesForUser<R extends Registry>(
  userId: string,
  deps: {
    ddb: Parameters<typeof readShownRows>[1]["ddb"]
    table: string
    bundled: ReadonlyMap<number, R>
  },
): Promise<R> {
  const rows = await readShownRows(userId, { ddb: deps.ddb, table: deps.table })
  const states = rows.map((r) => ({
    rulesVersionLastComputed:
      r.rulesVersionLastComputed === undefined || r.rulesVersionLastComputed === null
        ? undefined
        : Number(r.rulesVersionLastComputed),
  }))
  return pickBundledRules(userId, ledgerRulesVersion(states), deps.bundled)
}
