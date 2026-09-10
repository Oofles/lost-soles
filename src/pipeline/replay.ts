import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"

import type { IngestJob, SourceAdapter } from "@/src/adapters/types"
import type { SourceId } from "@/src/domain/activity"

/**
 * REPLAY FROM THE ARCHIVE. Ticket `0192`. `01-architecture.md` §3, D-101, D-121.2.
 *
 * A `reingest` job re-runs the pipeline over an activity that has already been processed. The bytes
 * it re-runs over come from **the S3 archive, never from the source**, and that is the one real
 * decision in this module.
 *
 * ─── WHY NOT JUST RE-FETCH ──────────────────────────────────────────────────
 *
 * Re-fetching is easier and it is wrong, for a reason that outranks the rate limit: **a source can
 * return different bytes for the same activity.** Strava alone can crop a trace for a new privacy
 * zone, apply a re-uploaded FIT file, or change what a segment effort says. So a replay that
 * re-fetches is not a replay — it is a fresh ingest wearing a replay's name, and it can reveal
 * *different ground* than the original run did.
 *
 * On a map that never re-fogs (D-020) that is not recoverable. Ground revealed by a replay of bytes
 * nobody has ever seen is permanent, and there is no operation that takes it back.
 *
 * The archive is the system of record precisely so this is not a dilemma. `SourceAdapter.normalize`
 * is documented as *"the function that outlives the client code to replay the S3 archive"*, and the
 * receipt carries `rawArchived` because *"if they landed, the failure is replayable forever from the
 * archive"*. This module is the thing that makes those sentences true rather than aspirational.
 *
 * A second benefit falls out for free: replay works with a revoked token, a disconnected source, or
 * an activity the user has since deleted upstream. Those are exactly the situations in which someone
 * most wants their map back.
 *
 * ─── IT IS A DECORATOR, AND THAT IS THE POINT ───────────────────────────────
 *
 * `replayAdapter` replaces `fetchRaw` and nothing else. `normalize` is the shipped one, byte for
 * byte — a replay path with its own normalizer would be a second implementation of the vendor's
 * wire format, and the two would drift the first time either was fixed.
 */

/** The S3 surface this module uses, and nothing more. Narrowed so a test passes a two-method stub. */
export interface ReplayS3 {
  send(command: ListObjectsV2Command): Promise<{
    Contents?: Array<{ Key?: string; LastModified?: Date }>
    IsTruncated?: boolean
  }>
  send(command: GetObjectCommand): Promise<{
    Body?: { transformToByteArray(): Promise<Uint8Array> }
    ContentType?: string
    Metadata?: Record<string, string>
  }>
}

export interface ReplayDeps {
  s3: ReplayS3
  bucket: string
}

/**
 * No archived object for this activity. **A hard stop, not a fallback to the network** — falling back
 * would silently reintroduce exactly the hazard this module exists to prevent, and it would do so in
 * the one case where nobody is watching.
 */
export class NoArchivedRawError extends Error {
  constructor(
    readonly prefix: string,
    readonly bucket: string,
  ) {
    super(
      `no archived raw payload under s3://${bucket}/${prefix}. A reingest cannot proceed: ` +
        "replaying from the source instead could reveal different ground on a map that never " +
        "re-fogs (D-020). Re-ingest it as a new activity if that is genuinely what is wanted.",
    )
    this.name = "NoArchivedRawError"
  }
}

/** `raw/<uid>/<source>/<externalId>/` — everything `archiveRaw` wrote for one activity. */
export function archivePrefix(input: {
  userId: string
  source: SourceId
  externalId: string
}): string {
  return `raw/${input.userId}/${input.source}/${input.externalId}/`
}

/**
 * The archived payload, in `fetchRaw`'s own shape.
 *
 * All four fields are RECOVERED FROM S3 rather than guessed: `contentType` from the object,
 * `schemaHint` from the user metadata `archiveRaw` writes (lower-cased in transit, hence
 * `schemahint`), and `ext` from the content-addressed key's own suffix. `01-architecture.md` §3 calls
 * the archive "self-describing"; this is the function that cashes that in.
 */
export async function readArchivedRaw(
  input: { userId: string; source: SourceId; externalId: string },
  deps: ReplayDeps,
): Promise<{ body: Buffer; contentType: string; ext: string; schemaHint: string; key: string }> {
  const prefix = archivePrefix(input)
  const listed = await deps.s3.send(
    new ListObjectsV2Command({ Bucket: deps.bucket, Prefix: prefix }),
  )
  const objects = (listed.Contents ?? []).filter((o) => o.Key && o.Key !== prefix)
  if (objects.length === 0) throw new NoArchivedRawError(prefix, deps.bucket)

  /**
   * NEWEST WINS, and the tie-break is the key so the choice is deterministic.
   *
   * More than one object under an activity is legitimate and `archive.ts` says why: the archive is
   * content-addressed, so a source that re-serialises its own response (different whitespace,
   * reordered keys) lands a second object — "correctly, because those are genuinely different
   * bytes". The newest is what the most recent ingest actually saw, which is the state the map was
   * built from. `Activity.raw.key` is the more precise answer where an `Activity` row exists; it is
   * not used here because a replay must also work for an activity whose row was never written.
   */
  const chosen = [...objects].sort((a, b) => {
    const at = a.LastModified?.getTime() ?? 0
    const bt = b.LastModified?.getTime() ?? 0
    return bt - at || (a.Key! < b.Key! ? -1 : 1)
  })[0]!

  const got = await deps.s3.send(
    new GetObjectCommand({ Bucket: deps.bucket, Key: chosen.Key! }),
  )
  if (!got.Body) throw new NoArchivedRawError(prefix, deps.bucket)

  const bytes = await got.Body.transformToByteArray()
  const ext = chosen.Key!.split(".").pop() ?? "bin"
  const schemaHint = got.Metadata?.schemahint

  if (!schemaHint) {
    // Loud rather than defaulted. The hint is what tells a future normalizer which shape these
    // bytes are; inventing one here would put a guess into the record §3 calls self-describing.
    throw new NoArchivedRawError(prefix, deps.bucket)
  }

  return {
    body: Buffer.from(bytes),
    contentType: got.ContentType ?? "application/octet-stream",
    ext,
    schemaHint,
    key: chosen.Key!,
  }
}

/**
 * The shipped adapter with `fetchRaw` pointed at the archive.
 *
 * `credentials` are still loaded by the caller and still passed in — unused by this `fetchRaw`, and
 * deliberately not removed from the signature, because the decorator's whole value is that
 * everything except the byte source is identical to the real path.
 */
export function replayAdapter<TCreds>(
  adapter: SourceAdapter<TCreds>,
  deps: ReplayDeps,
): SourceAdapter<TCreds> {
  return {
    ...adapter,
    fetchRaw: async (job: IngestJob) => {
      const { body, contentType, ext, schemaHint } = await readArchivedRaw(
        { userId: job.userId, source: job.source, externalId: job.externalId },
        deps,
      )
      return { body, contentType, ext, schemaHint }
    },
  }
}
