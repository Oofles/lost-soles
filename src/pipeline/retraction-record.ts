import { PutObjectCommand } from "@aws-sdk/client-s3"

import type { SourceId } from "@/src/domain/activity"
import { isPreconditionFailed } from "@/src/pipeline/archive"

/**
 * THE RETRACTION RECORD, BESIDE THE RAW ARCHIVE. Ticket `0301`, D-355, D-101.
 *
 * A confirmed source-side delete sets T3 `status = TOMBSTONED` and nothing else (`retract.ts`).
 * Without a record outside T3, a rebuild from `raw/` alone (`02` §8.3) brings the activity back as
 * `ACTIVE`, so D-101's "everything is reconstructible from raw" would not hold for retractions.
 *
 * `raw/<uid>/<source>/<externalId>.retracted.json` — a SIBLING of the activity's archive prefix,
 * the shape D-263's duplicate-of pointer set. `replay.ts` lists `raw/<uid>/<source>/<externalId>/`
 * (trailing slash) and replays the newest object there, so a record filed inside the prefix would be
 * replayed as the run. Under `raw/*` it inherits I-3: the bucket policy denies deletion to every
 * principal but the break-glass role, and `IfNoneMatch: "*"` refuses an overwrite. That suits a
 * tombstone, which is sticky. The worker already holds `s3:PutObject` on `raw/*`, so no new grant.
 *
 * Written BEFORE the T3 tombstone, as the archive is written before persist: the system of record
 * first, the derived row second. A throw leaves T3 untouched and SQS redelivers. A redelivery
 * writes the same fact, so the `If-None-Match` refusal counts as success.
 */
export const RETRACTION_RECORD_SUFFIX = ".retracted.json"

export function retractionRecordKey(input: { userId: string; source: SourceId; externalId: string }): string {
  return `raw/${input.userId}/${input.source}/${input.externalId}${RETRACTION_RECORD_SUFFIX}`
}

export interface RetractionRecordDeps {
  s3: { send(command: PutObjectCommand): Promise<unknown> }
  bucket: string
}

export async function recordRetraction(
  input: { userId: string; source: SourceId; externalId: string; activityId: string },
  deps: RetractionRecordDeps,
  now: Date,
): Promise<string> {
  const key = retractionRecordKey(input)
  try {
    await deps.s3.send(
      new PutObjectCommand({
        Bucket: deps.bucket,
        Key: key,
        ContentType: "application/json",
        IfNoneMatch: "*",
        Body: JSON.stringify({
          retracted: true,
          activityId: input.activityId,
          source: input.source,
          externalId: input.externalId,
          confirmedAt: now.toISOString(),
        }),
      }),
    )
  } catch (error) {
    if (!isPreconditionFailed(error)) throw error
  }
  return key
}
