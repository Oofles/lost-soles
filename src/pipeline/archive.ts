import { createHash } from "node:crypto"

import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ServiceException,
} from "@aws-sdk/client-s3"

import { APP_VERSION } from "@/lib/app-meta"
import type { RawArchiveRef, SourceId } from "@/src/domain/activity"

/**
 * THE ARCHIVE. Ticket 0039, `01-architecture.md` §3 "D-121 mitigation: archive raw
 * before normalize", D-101, D-121.2, I-3.
 *
 * ─── WHAT THIS MODULE IS FOR ────────────────────────────────────────────────
 *
 * D-101 makes `raw/` the SYSTEM OF RECORD. Everything else in this project is
 * derived and therefore rebuildable — the activity rows, the trace, the cells, the
 * XP ledger, the fog blob. These bytes are not. When the user moves to owned
 * hardware (D-117), or the MVP source withdraws access (D-121), or a gap-detection
 * bug is fixed, or the H3 resolution changes (`05-fog-of-war.md` §2.1), the recovery
 * is the same one move: replay `raw/` through a NEW normalize. That move is only
 * available if the bytes were kept exactly.
 *
 * (This module names no source, and cannot: `check-boundaries.mjs` treats
 * `src/pipeline` as source-agnostic down to the prose in its comments — D-100,
 * `01-architecture.md` §3 T1.)
 *
 * It matters more here than it would elsewhere because the map never re-fogs
 * (D-020). A trace normalized wrongly is not a stale cache; it is a permanent,
 * uncorrectable error written into the one artifact the product exists to produce.
 * The archive is what makes that error correctable.
 *
 * ─── WHAT THIS MODULE MUST NOT DO ───────────────────────────────────────────
 *
 * IT MUST NOT LOOK AT THE BYTES. Not to pretty-print, not to strip a field, not to
 * re-encode, not to sniff a content type, not even to check that they parse. Every
 * one of those is a transformation, and §3.1 rule 2 forbids all of them by name.
 * The content type, the extension and the schema hint are all DECLARED by the
 * adapter and copied through untouched — see `SourceAdapter.fetchRaw`.
 *
 * The consequence is deliberate: a malformed payload is archived malformed. The
 * archive's job is to hold what arrived. A wrapper that "fixed" a bad payload on
 * the way in would destroy the only evidence of what actually went wrong.
 */

/**
 * The key. `raw/<userId>/<source>/<externalId>/<sha256>.<ext>`.
 *
 * SELF-DESCRIBING BY CONSTRUCTION, which is the requirement `01-architecture.md` §3
 * states as "a backfill five years from now can identify what it is looking at
 * without a database". Every part of the provenance is in the path: whose it is,
 * where it came from, which activity it is, and — from the digest — whether it is
 * the bytes anyone thinks it is.
 *
 * CONTENT-ADDRESSED, which is what makes the write idempotent. A redelivered SQS
 * message re-fetches the same payload, hashes to the same digest, and lands on the
 * same key. There is no "have I archived this?" query, because the key IS the
 * answer. Note the strength of the guarantee and its limit: identical bytes always
 * collide onto one object, but a source that re-serialises its own response
 * (different whitespace, reordered keys) yields a second object under the same
 * activity — correctly, because those are genuinely different bytes and the archive
 * is not in the business of deciding two payloads are "the same really".
 */
export function rawArchiveKey(input: {
  userId: string
  source: SourceId
  externalId: string
  sha256: string
  ext: string
}): string {
  return `raw/${input.userId}/${input.source}/${input.externalId}/${input.sha256}.${input.ext}`
}

/** What `fetchRaw` declared about the bytes, plus who they belong to. */
export interface RawArchiveInput {
  userId: string
  source: SourceId
  externalId: string
  /** VERBATIM, exactly as the source returned them. See the module comment. */
  body: Buffer
  /** All three DECLARED by the adapter, never inferred from the bytes. */
  contentType: string
  ext: string
  schemaHint: string
}

/**
 * The S3 surface `archiveRaw` uses, and nothing more.
 *
 * Narrowed to a structural type rather than taking `S3Client` so a test can pass a
 * two-method stub without constructing a client or reaching for a mocking library —
 * the same reasoning the adapter contract applies to its own seams. It also keeps
 * the failure honest: a stub that rejects is indistinguishable to this module from
 * S3 rejecting, which is exactly what the ordering test needs to be true.
 */
export interface ArchiveS3 {
  send(command: PutObjectCommand): Promise<{ ETag?: string }>
  send(command: HeadObjectCommand): Promise<{ LastModified?: Date; ETag?: string }>
}

/**
 * The bucket. Supplied by the caller in production (the worker reads it from an
 * environment variable the CDK sets, ticket 0042), because `defineStorage`
 * generates the name and nothing may hard-code it.
 */
export interface ArchiveDeps {
  s3: ArchiveS3
  bucket: string
  /** Injected so `archivedAt` is testable. Never called before the PUT succeeds. */
  now?: () => Date
}

/**
 * Thrown when the archive PUT fails. THE PIPELINE MUST NOT CONTINUE PAST THIS —
 * see `fetch-archive-normalize.ts`, which is the module that enforces it.
 *
 * A distinct type rather than a rethrown `S3ServiceException` because the caller's
 * question is not "what did S3 say", it is "is the system of record intact". The
 * original is kept on `cause` for the log.
 */
export class RawArchiveError extends Error {
  readonly key: string

  constructor(key: string, cause: unknown) {
    super(`Failed to archive raw payload to ${key}`)
    this.name = "RawArchiveError"
    this.key = key
    this.cause = cause
  }
}

/** S3 answers a refused conditional write with 412 and this code. */
function isPreconditionFailed(error: unknown): boolean {
  const e = error as S3ServiceException | undefined
  return e?.name === "PreconditionFailed" || e?.$metadata?.httpStatusCode === 412
}

/**
 * Writes the payload and returns the ref that `normalize()` is handed.
 *
 * ─── `IfNoneMatch: "*"` — THE OVERWRITE HALF OF I-3 ──────────────────────────
 *
 * I-3 requires `raw/` objects to be immutable, and names both deletion and
 * OVERWRITE. Deletion is denied by bucket policy (`amplify/backend.ts`). Overwrite
 * cannot be: there is no IAM condition that refuses a PUT onto an existing key
 * while permitting the first one, so a policy that could stop an overwrite would
 * also stop every write. D-205 records the resolution, which is two independent
 * mechanisms rather than one:
 *
 *   1. STRUCTURAL — bucket versioning is on and `s3:DeleteObjectVersion` is denied
 *      alongside `s3:DeleteObject`. An overwrite therefore cannot DESTROY anything;
 *      it can only add a version, and the original bytes stay readable forever.
 *      This is the half that holds even against a caller that never runs this code.
 *   2. HERE — the conditional PUT means a re-archive is refused by S3 rather than
 *      written as a redundant second version, so the common case (an SQS
 *      redelivery) leaves exactly one object with exactly one version.
 *
 * A 412 IS A SUCCESS, not an error, and treating it as one is the whole point: the
 * key is the sha256 of these bytes, so an object already sitting at it necessarily
 * holds these bytes. The ref is then built from the EXISTING object's
 * `LastModified` via a HEAD, not from the clock — `archivedAt` means "when the
 * system of record acquired these bytes", and the second attempt did not acquire
 * anything. Stamping `now()` there would make a replay silently rewrite the
 * provenance of an object it did not write.
 */
export async function archiveRaw(
  input: RawArchiveInput,
  deps: ArchiveDeps,
): Promise<RawArchiveRef> {
  const sha256 = createHash("sha256").update(input.body).digest("hex")
  const key = rawArchiveKey({ ...input, sha256 })

  /**
   * `01-architecture.md` §3: "object metadata carries `adapter`, `externalId`,
   * `userId`, `schemaHint`, and the app version". S3 user metadata is ASCII-only
   * and lower-cases its keys in transit, so these are written lower-case here
   * rather than being surprised by it on the way back out.
   *
   * `adapter`, not `source`, because that is the word §3 uses and a backfill will
   * be reading §3 rather than this file.
   */
  const metadata = {
    adapter: input.source,
    externalid: input.externalId,
    userid: input.userId,
    schemahint: input.schemaHint,
    appversion: APP_VERSION,
  }

  try {
    await deps.s3.send(
      new PutObjectCommand({
        Bucket: deps.bucket,
        Key: key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: metadata,
        /** See above. The refusal on an existing key is the desired outcome. */
        IfNoneMatch: "*",
        /**
         * The digest S3 verifies the upload against. Not decoration: it turns a
         * truncated or corrupted transfer into a rejected PUT rather than an object
         * whose key claims a digest its bytes do not have — which, on a
         * content-addressed store, is the one corruption nothing downstream could
         * ever detect.
         */
        ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
      }),
    )

    return {
      bucket: deps.bucket,
      key,
      contentType: input.contentType,
      bytes: input.body.byteLength,
      sha256,
      archivedAt: (deps.now?.() ?? new Date()).toISOString(),
    }
  } catch (error) {
    if (!isPreconditionFailed(error)) throw new RawArchiveError(key, error)

    /**
     * Already archived. HEAD it for the ORIGINAL `archivedAt` — see the comment
     * above on why this is not `now()`.
     *
     * If the HEAD itself fails, that is a genuine archive failure and is thrown as
     * one: we have been told an object exists and cannot confirm it, which is not a
     * state to normalize from.
     */
    try {
      const head = await deps.s3.send(new HeadObjectCommand({ Bucket: deps.bucket, Key: key }))
      return {
        bucket: deps.bucket,
        key,
        contentType: input.contentType,
        bytes: input.body.byteLength,
        sha256,
        archivedAt: (head.LastModified ?? deps.now?.() ?? new Date()).toISOString(),
      }
    } catch (headError) {
      throw new RawArchiveError(key, headError)
    }
  }
}

/**
 * The production client. Module-scoped so a warm Lambda reuses the connection pool;
 * created lazily so importing this module in a test does not require credentials.
 */
let client: S3Client | undefined

export function rawArchiveClient(): S3Client {
  client ??= new S3Client({})
  return client
}
