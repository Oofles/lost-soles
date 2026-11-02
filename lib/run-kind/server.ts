import { customOutput, defaultDdb, queryAll, type QueryDdb } from "@/lib/aws-server"

import type { ActivityKindRow } from "./kind"

/**
 * THE RUN PAGE'S KIND READ, ON THE SSR COMPUTE. Ticket `0331`, D-472 (was `0244`'s `Activity.get`).
 *
 * A `Query` on T3's base table by `id`, not a `GetItem`: the SSR compute already holds `Query` on T3
 * (`0195`) and nothing else, and adding `GetItem` would widen it for no gain. The OWNER FILTER is
 * explicit (`userId = :u`, from `currentUserId()`): another user's activity reads as `null`, which
 * is what AppSync's owner rule returned for it.
 */

export interface ActivityKindDeps {
  ddb: QueryDdb
  activityTable: string
}

export const defaultActivityKindDeps = (): ActivityKindDeps => ({
  ddb: defaultDdb(),
  activityTable: customOutput("activityTableName"),
})

export async function activityKind(userId: string, activityId: string, deps: ActivityKindDeps): Promise<ActivityKindRow | null> {
  const [row] = await queryAll(deps.ddb, {
    TableName: deps.activityTable,
    KeyConditionExpression: "#id = :id",
    FilterExpression: "#u = :u",
    ExpressionAttributeNames: { "#id": "id", "#u": "userId", "#k": "kind", "#d": "derivedKind", "#o": "kindOverride" },
    ExpressionAttributeValues: { ":id": activityId, ":u": userId },
    ProjectionExpression: "#k, #d, #o",
  })
  if (!row) return null
  const override = row.kindOverride as { kind?: unknown } | null | undefined
  return {
    kind: typeof row.kind === "string" ? row.kind : "",
    derivedKind: typeof row.derivedKind === "string" ? row.derivedKind : null,
    kindOverride: override && typeof override.kind === "string" ? { kind: override.kind } : null,
  }
}
