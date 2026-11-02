import { customOutput, defaultDdb, queryAll, type QueryDdb } from "@/lib/aws-server"

import type { ActivityLedgerRow } from "./ledger"

/**
 * THE RUN PAGE'S LEDGER READ, ON THE SSR COMPUTE. Ticket `0331`, D-472 (was `0078`'s AppSync call).
 *
 * T4's `byActivity` index. Its partition key is the activity, not the user, so the OWNER FILTER is
 * explicit: `userId = :u` with `userId` from `currentUserId()`. AppSync's owner rule did this before;
 * an activity id that is another user's returns no rows here, as it returned none there. No `Limit`,
 * because DynamoDB applies one before the filter.
 */

export interface ActivityLedgerDeps {
  ddb: QueryDdb
  ledgerTable: string
}

export const defaultActivityLedgerDeps = (): ActivityLedgerDeps => ({
  ddb: defaultDdb(),
  ledgerTable: customOutput("xpLedgerTableName"),
})

/** Every ledger row this activity earned for this user. A run is a handful of rows. */
export async function activityLedger(userId: string, activityId: string, deps: ActivityLedgerDeps): Promise<ActivityLedgerRow[]> {
  const items = await queryAll(deps.ddb, {
    TableName: deps.ledgerTable,
    IndexName: "byActivity",
    KeyConditionExpression: "#a = :a",
    FilterExpression: "#u = :u",
    ExpressionAttributeNames: {
      "#a": "activityId",
      "#u": "userId",
      "#sk": "skillId",
      "#r": "reason",
      "#x": "xpAwarded",
      "#v": "xpRulesVersion",
      "#f": "isFloor",
      "#n": "units",
    },
    ExpressionAttributeValues: { ":a": activityId, ":u": userId },
    ProjectionExpression: "#sk, #r, #x, #v, #f, #n",
  })
  return items.map((r) => ({
    skillId: typeof r.skillId === "string" ? r.skillId : "",
    reason: typeof r.reason === "string" ? r.reason : "",
    xpAwarded: typeof r.xpAwarded === "number" ? r.xpAwarded : 0,
    xpRulesVersion: typeof r.xpRulesVersion === "number" ? r.xpRulesVersion : 0,
    isFloor: r.isFloor === true,
    ...(typeof r.units === "number" ? { units: r.units } : {}),
  }))
}
