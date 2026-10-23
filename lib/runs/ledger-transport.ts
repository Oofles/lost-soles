/**
 * THE RUN PAGE'S LEDGER READ. Ticket `0078`.
 *
 * `XpLedgerEntry`'s `byActivity` index (T4 GSI1, *"which rows did this activity earn — the post-run
 * card"*), straight to AppSync with the signed-in user's token, as `/skills`' reads are. Owner-scoped
 * by the model's `allow.owner().to(["read"])`: another account's rows are simply not returned, so
 * there is no user id here to pass.
 */

import type { Schema } from "@/amplify/data/resource"
import { withApiTimeout } from "@/lib/http/timeout"
import { errorFrom } from "@/lib/log/transport"

import type { ActivityLedgerRow } from "./ledger"

type DataClient = ReturnType<typeof import("aws-amplify/data").generateClient<Schema>>
let client: Promise<DataClient> | undefined

function dataClient(): Promise<DataClient> {
  client ??= import("aws-amplify/data").then(({ generateClient }) => generateClient<Schema>())
  return client
}

/** `06` §9.5's 10 s, the shared helper (0113). Amplify's data client takes no signal; the race is the timeout. */
function timed<T>(p: Promise<T>, what: string): Promise<T> {
  return withApiTimeout(what, () => p)
}

/** Every ledger row this activity earned. A run is a handful of rows (one per skill and reason). */
export async function fetchActivityLedger(activityId: string): Promise<ActivityLedgerRow[]> {
  const c = await dataClient()
  const out: ActivityLedgerRow[] = []
  let nextToken: string | null | undefined
  do {
    const { data, errors, nextToken: more } = await timed(
      c.models.XpLedgerEntry.listXpLedgerEntryByActivityIdAndSkillIdReason(
        { activityId },
        { limit: 100, nextToken, selectionSet: ["skillId", "reason", "xpAwarded", "xpRulesVersion", "isFloor", "units"] },
      ),
      "XpLedgerEntry.byActivity",
    )
    if (errors?.length) throw errorFrom(errors)
    for (const r of data) {
      out.push({
        skillId: r.skillId,
        reason: r.reason,
        xpAwarded: r.xpAwarded,
        xpRulesVersion: r.xpRulesVersion,
        isFloor: r.isFloor,
        units: r.units,
      })
    }
    nextToken = more
  } while (nextToken)
  return out
}
