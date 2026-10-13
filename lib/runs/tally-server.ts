import { QueryCommand } from "@aws-sdk/lib-dynamodb"

import outputs from "@/amplify_outputs.json"
import { ledgerSeq } from "@/src/scoring/ledger"
import { FLOOR_SEQ_PREFIX } from "@/src/scoring/reconcile"

import type { RunQueryDdb } from "./server"

/**
 * WHERE EACH SKILL STOOD BEFORE THIS RUN. Ticket `0081`, D-296. `06-ui-ux.md` §3.2 beat 2.
 *
 * The tally's bars, its `L41 ↑` and Total XP's `old → new` all start from "before". It is read AS OF
 * THE RUN, not relative to today: Relive on a run from March shows the levels it was earned at, so
 * "before" is the ledger's sum over every row that sorts ahead of this run in replay order
 * (`seq`, 04 §7.4 — `<startedAt>#<activityId>#<nn>`), on T4's `byUserAndSeq` index.
 *
 * ─── FLOOR ROWS COUNT, WHATEVER THEIR SEQ ───────────────────────────────────
 *
 * A `retained_floor` row (D-135) sorts after everything (`FLOOR_SEQ_PREFIX`, year 9999) because it
 * belongs to no activity — but it holds XP the user ALREADY HAD when a ruleset change would have
 * lowered it, so it is part of every "before". Without it the newest run's `after` would disagree
 * with the Skills panel by exactly the floor, and I-15 (`displayedXp == SUM(ledger)`) would look
 * false on this screen alone. It is fetched by a second, prefix-bounded query and added in.
 *
 * Every version is summed, as `skillDetail` does: a floor row is stamped with the version that wrote
 * it and still counts (D-290's finding). A replay caught mid-flight could double a run for a moment;
 * that is the replay job's window and not one this read can see.
 *
 * Same `userId` contract as `server.ts`: the partition key comes from the verified session only.
 */

export interface LedgerReadDeps {
  ddb: RunQueryDdb
  ledgerTable: string
}

/** T4's name, from `amplify_outputs.json` — written by `backend.addOutput` (`0081`). */
export function ledgerTableName(): string {
  const name = (outputs as { custom?: { xpLedgerTableName?: string } }).custom?.xpLedgerTableName
  if (!name) {
    throw new Error(
      "amplify_outputs.json has no custom.xpLedgerTableName. It is written by backend.addOutput " +
        "in amplify/backend.ts (ticket 0081); a missing value means this build predates that deploy.",
    )
  }
  return name
}

type Row = { skillId?: unknown; xpAwarded?: unknown }

async function sumInto(
  into: Record<string, number>,
  deps: LedgerReadDeps,
  key: { expr: string; values: Record<string, string> },
): Promise<void> {
  let start: Record<string, unknown> | undefined
  do {
    const out = (await deps.ddb.send(
      new QueryCommand({
        TableName: deps.ledgerTable,
        IndexName: "byUserAndSeq",
        KeyConditionExpression: key.expr,
        ExpressionAttributeNames: { "#u": "userId", "#s": "seq" },
        ExpressionAttributeValues: key.values,
        // Two attributes of ~15 a row: the whole ledger in one or two pages for years.
        ProjectionExpression: "skillId, xpAwarded",
        ExclusiveStartKey: start,
      }),
    )) as { Items?: Row[]; LastEvaluatedKey?: Record<string, unknown> }
    for (const r of out.Items ?? []) {
      if (typeof r.skillId !== "string" || typeof r.xpAwarded !== "number" || r.xpAwarded <= 0) continue
      into[r.skillId] = (into[r.skillId] ?? 0) + r.xpAwarded
    }
    start = out.LastEvaluatedKey
  } while (start)
}

/** Σ `xpAwarded` per skill over every row ahead of this run, plus every floor row. */
export async function xpBeforeRun(
  userId: string,
  run: { activityId: string; startedAt: string },
  deps: LedgerReadDeps,
): Promise<Record<string, number>> {
  // `nn = 0` is this run's first row; everything strictly below it is earlier in replay order.
  const cut = ledgerSeq(run.startedAt, run.activityId, 0)
  const before: Record<string, number> = {}
  await Promise.all([
    sumInto(before, deps, { expr: "#u = :u AND #s < :cut", values: { ":u": userId, ":cut": cut } }),
    sumInto(before, deps, {
      expr: "#u = :u AND begins_with(#s, :floor)",
      values: { ":u": userId, ":floor": FLOOR_SEQ_PREFIX },
    }),
  ])
  return before
}
