import { GetObjectCommand } from "@aws-sdk/client-s3"

import { getAdapter } from "@/src/adapters/registry"
import type { IngestJob } from "@/src/adapters/types"
import type { Activity, Trace } from "@/src/domain/activity"

/**
 * AN ACTIVITY'S TRACE, FROM ITS ARCHIVED BYTES THROUGH THE SHIPPED NORMALIZER — the bytes ingest
 * scored, never a re-fetch (D-121, D-284 a). `rescoreKind`'s `loadTrace`, shared by the operator's
 * tool (`tools/kind-override`) and the `setActivityKind` resolver (`0244`) so the two cannot come
 * to read a trace differently.
 */
export async function archivedTrace(
  activity: Activity,
  deps: { s3: { send(command: GetObjectCommand): Promise<{ Body?: { transformToByteArray(): Promise<Uint8Array> } }> } },
  ingestKey: string,
): Promise<Trace | undefined> {
  if (!activity.hasTrace) return undefined
  if (!activity.raw) throw new Error(`${activity.activityId} has a trace but no raw archive reference`)
  const got = await deps.s3.send(new GetObjectCommand({ Bucket: activity.raw.bucket, Key: activity.raw.key }))
  const body = Buffer.from(await got.Body!.transformToByteArray())
  const job: IngestJob = {
    ingestKey,
    userId: activity.userId,
    source: activity.source.source,
    externalId: activity.source.externalId,
    command: "reingest",
    startedAt: activity.startedAt,
    meta: null,
    enqueuedAt: new Date().toISOString(),
  }
  return getAdapter(activity.source.source).normalize(body, activity.raw, job).trace
}
