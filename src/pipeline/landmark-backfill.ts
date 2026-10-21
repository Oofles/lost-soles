import { gunzipSync } from "node:zlib"

import { GetObjectCommand } from "@aws-sdk/client-s3"
import { QueryCommand } from "@aws-sdk/lib-dynamodb"

import type { WalkRow } from "./landmarks"
import { routeTraceKey, type RouteTraceGeometry } from "./route-trace-store"

/**
 * THE LANDMARK BACKFILL'S READS. Ticket `0302` (from `0248`'s tool). Both halves of
 * `tools/landmarks/backfill-landmarks.ts`'s input, against whichever stack it is pointed at: the
 * live tables and bucket, or a rebuild drill's target (D-406) with its staging prefix. The walk
 * and the placing are `backfillLandmarks` (`landmarks.ts`), shared with the drill's step 6.
 */

interface Sender {
  send(command: unknown): Promise<unknown>
}

/** T4's `byUserAndSeq`, the whole partition, as the walk needs it. */
export async function readWalkRows(ddb: Sender, ledgerTable: string, userId: string): Promise<WalkRow[]> {
  const rows: WalkRow[] = []
  let start: Record<string, unknown> | undefined
  do {
    const out = (await ddb.send(
      new QueryCommand({
        TableName: ledgerTable,
        IndexName: "byUserAndSeq",
        KeyConditionExpression: "#u = :u",
        ExpressionAttributeNames: { "#u": "userId" },
        ExpressionAttributeValues: { ":u": userId },
        ExclusiveStartKey: start,
      }),
    )) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> }
    for (const r of out.Items ?? []) {
      rows.push({ skillId: String(r.skillId), activityId: String(r.activityId), xpAwarded: Number(r.xpAwarded), seq: String(r.seq) })
    }
    start = out.LastEvaluatedKey
  } while (start)
  return rows
}

/** One activity's stored route (`0195`), or `null` when it has none. `prefix` is a drill target's. */
export async function readStoredRoute(
  s3: Sender,
  where: { bucket: string; prefix?: string },
  userId: string,
  activityId: string,
): Promise<RouteTraceGeometry | null> {
  try {
    const out = (await s3.send(
      new GetObjectCommand({ Bucket: where.bucket, Key: `${where.prefix ?? ""}${routeTraceKey(userId, activityId)}` }),
    )) as { Body?: { transformToByteArray(): Promise<Uint8Array> } }
    if (!out.Body) return null
    return JSON.parse(gunzipSync(await out.Body.transformToByteArray()).toString("utf8")) as RouteTraceGeometry
  } catch (e) {
    if ((e as Error).name === "NoSuchKey") return null
    throw e
  }
}
