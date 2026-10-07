/**
 * THE BROWSER'S READS FOR `/skills`. Ticket 0073.
 *
 * `SkillState` comes through `/log`'s `fetchSkills` — one call, one cache key, so the two pages
 * can never show different standings. What is added here is what only the panel needs:
 *
 * - **Recent sessions** for the `NEXT` line: the newest ledger rows across every skill, from
 *   `XpLedgerEntry`'s `byUserAndSeq` index (GSI2), newest activity first and bounded. Never the
 *   whole ledger.
 *
 *   Not `bySkill` (GSI3): NEXT wants the newest sessions across every skill, and GSI3 is one
 *   skill's history. (Until 0242 it could not be queried through AppSync at all: its INCLUDE
 *   projection lacked `owner`, which AppSync's owner rule filters on. It now projects ALL.)
 * - **`Profile.replayInProgress`**, `0066`'s read-side gate (`02` §4.4 step 1).
 *
 * Owner-scoped by AppSync's auth rule; nothing here passes a user id it was not handed by the
 * session.
 */

import type { Schema } from "@/amplify/data/resource"
import { API_TIMEOUT_MS, errorFrom } from "@/lib/log/transport"

import type { SkillLedgerRow } from "./next"

/**
 * How many of the newest ledger rows are read. A session is one to five rows (one per skill and
 * reason), so this covers the last ~100 activities: every skill trained in that window gets its
 * trailing median, and one not trained in it gets no estimate, which is honest.
 */
export const LEDGER_ROWS = 500
const PAGE = 250

type DataClient = ReturnType<typeof import("aws-amplify/data").generateClient<Schema>>
let client: Promise<DataClient> | undefined

function dataClient(): Promise<DataClient> {
  client ??= import("aws-amplify/data").then(({ generateClient }) => generateClient<Schema>())
  return client
}

function timed<T>(p: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${API_TIMEOUT_MS} ms`)), API_TIMEOUT_MS)),
  ])
}

/** The user's newest ledger rows, newest activity first, at most `LEDGER_ROWS`. */
export async function fetchRecentLedger(uid: string): Promise<SkillLedgerRow[]> {
  const c = await dataClient()
  const out: SkillLedgerRow[] = []
  let nextToken: string | null | undefined
  do {
    const { data, errors, nextToken: more } = await timed(
      c.models.XpLedgerEntry.listXpLedgerEntryByUserIdAndSeq(
        { userId: uid },
        {
          sortDirection: "DESC",
          limit: Math.min(PAGE, LEDGER_ROWS - out.length),
          nextToken,
          selectionSet: ["skillId", "activityId", "xpAwarded", "xpRulesVersion", "isFloor", "seq"],
        },
      ),
      "XpLedgerEntry.byUserAndSeq",
    )
    if (errors?.length) throw errorFrom(errors)
    for (const r of data) {
      out.push({ skillId: r.skillId, activityId: r.activityId, xpAwarded: r.xpAwarded, xpRulesVersion: r.xpRulesVersion, isFloor: r.isFloor, seq: r.seq })
    }
    nextToken = more
  } while (nextToken && out.length < LEDGER_ROWS)
  return out
}

/** `Profile.replayInProgress`. `false` for a user with no Profile row yet. */
export async function fetchReplayInProgress(uid: string): Promise<boolean> {
  const c = await dataClient()
  const { data, errors } = await timed(c.models.Profile.get({ id: uid }, { selectionSet: ["id", "replayInProgress"] }), "Profile.get")
  if (errors?.length) throw errorFrom(errors)
  return data?.replayInProgress === true
}
