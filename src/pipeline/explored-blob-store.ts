import { gunzipSync, gzipSync } from "node:zlib"

import {
  GetObjectCommand,
  PutObjectCommand,
  type S3ServiceException,
} from "@aws-sdk/client-s3"
import type { H3Index } from "h3-js"

import { computeAgg, type ExploredAgg } from "@/src/domain/explored-agg"
import {
  BlobFormatError,
  cellToBig,
  decodeExploredBlob,
  decodeLastRunBlob,
  encodeDeltaBlob,
  encodeExploredBlob,
  encodeLastRunBlob,
  mergeCells,
  mergeLastRunDays,
  type LastRunBlob,
} from "@/src/domain/explored-blob"
import { RES } from "@/src/domain/fog"

import { bumpGeneration, type GenerationDeps } from "./explored-generation"

/**
 * THE DELIVERY LAYER'S WRITER. Ticket `0049`. `02-data-model.md` §2.10, §6.1, §6.4;
 * `05-fog-of-war.md` §7.1–§7.4; I-11.
 *
 * ─── §2.10 IS THE WHOLE POINT OF THIS FILE ──────────────────────────────────
 *
 * *"Blob regeneration does not re-read the table."* The naive rebuild `Query`s every res-6
 * partition — ~24 MB of reads, ~3,000 RRU per run — and `02` §5.6 is blunt about it:
 * *"The one thing that could break this [the five-year bill] is a full-table `Query`
 * (AP-16) on the ingest hot path. Calling it from `process-activity` is a review-blocking
 * bug."*
 *
 * So the hot path never reads T6 for the map at all:
 *
 *   GET explored-r10.<gen-1>.bin  →  decode  →  merge this run's 40–130 cells
 *   →  encode, gzip, PUT the new generation  →  PUT manifest.json
 *
 * The `Query` path still exists — as `explored-rebuild.ts`, AP-17, the **repair** path,
 * invoked by the rebuild drill and a consistency check. Never from here.
 *
 * ─── THE MANIFEST IS THE COMMIT POINT ───────────────────────────────────────
 *
 * `02` §6.4, in one line: *"bump `generation` and write the new blobs before writing the
 * new `manifest.json`."* A crash before it leaves orphan blobs, which are harmless and
 * garbage-collected. A crash after it would point clients at an object that does not
 * exist. **There is no third possibility, because the manifest PUT is a single atomic S3
 * operation.**
 *
 * ─── AND IT IS WRITTEN CONDITIONALLY, WHICH §6.4 DOES NOT SAY ───────────────
 *
 * Allocating a unique generation stops two concurrent workers writing the same filename
 * (`explored-generation.ts`). It does **not** stop them merging from the same base: A and
 * B both read generation 41, A publishes 42 = blob41 + runA, B publishes 43 = blob41 +
 * runB — and runA's cells are simply gone from 43 and from everything after it. The table
 * still has them, so this is not a re-fog (D-020 holds), but the payload has silently lost
 * ground and only an AP-17 repair would ever bring it back.
 *
 * The manifest PUT therefore carries `IfMatch` on the ETag the base was read from. The
 * loser gets a 412, discards its work and re-merges against the winner's blob. **This is
 * the merge chain being linear, expressed as a precondition** — and it is why the
 * allocator is a counter rather than "manifest + 1": the loser's blob 43 is an orphan, and
 * a counter guarantees no later run ever writes DIFFERENT bytes to that same immutable
 * name. See D-219.
 */

/** `Cache-Control` for everything named by `<gen>`. A generation is never rewritten. */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"
/** `manifest.json`, the only mutable object in the delivery path. A 304 is a few hundred bytes. */
export const MANIFEST_CACHE_CONTROL = "no-cache"

/**
 * `users/<uid>/…`, exactly as `02` §6.1 and `05` §7.3 lay it out.
 *
 * `<uid>` is the Cognito `sub` — T1: *"`id = userId`. Also the `<uid>` in every S3 key and
 * every other table's partition key."* Note this is NOT the same string as the identity-pool
 * id that `amplify/storage/resource.ts` scopes browser access by (`users/{entity_id}/*`),
 * so the client cannot yet read what this writes. That gap belongs to `0054`, which owns
 * the loader; see ticket `0181`.
 */
export const objectKeys = {
  manifest: (userId: string) => `users/${userId}/manifest.json`,
  cells: (userId: string, gen: number) => `users/${userId}/explored/explored-r10.${gen}.bin`,
  agg: (userId: string, gen: number) => `users/${userId}/explored/explored-agg.${gen}.json`,
  lastRun: (userId: string, gen: number) =>
    `users/${userId}/explored/explored-lastrun-r10.${gen}.bin`,
  delta: (userId: string, from: number, to: number) => `users/${userId}/deltas/${from}-${to}.bin`,
}

/** `02` §6.1's field list, exactly. `0051` asserts it is exactly this and nothing more. */
export interface ExploredManifest {
  generation: number
  res: number
  cellCount: number
  updatedAt: string
  cells: string
  agg: string
  lastRun: string
  /** The oldest generation the delta chain still reaches. `0051` owns the GC that moves it. */
  deltasFrom: number
}

/** The S3 surface this module uses. Narrowed so a test needs a two-method stub, not a client. */
export interface BlobStoreS3 {
  send(command: GetObjectCommand): Promise<{
    Body?: { transformToByteArray(): Promise<Uint8Array> }
    ETag?: string
  }>
  send(command: PutObjectCommand): Promise<{ ETag?: string }>
}

export interface BlobStoreDeps extends GenerationDeps {
  s3: BlobStoreS3
  bucket: string
  /** Injected so `updatedAt` is assertable. */
  now?: () => Date
  /**
   * How many times to re-merge after losing the manifest race. Three is generous: losing
   * twice in a row needs three workers for one user interleaving inside one S3 round trip.
   */
  maxAttempts?: number
}

/** What one regeneration published. Returned for the log line and for `0051`'s mirror. */
export interface RegenerateResult {
  generation: number
  previousGeneration: number
  cellCount: number
  /** Cells this activity added that the previous generation did not hold. */
  addedCount: number
  /** How many times the manifest precondition failed before this one committed. */
  conflicts: number
  /**
   * The previous sidecar could not be used and every untouched cell's `lastRunDay` was
   * reset to 0. **Not an error, and deliberately not a throw** — `explored-lastrun-r10.bin`
   * feeds one optional overlay (§8.5, D-133) and nothing else, so failing an ingest over it
   * would block the map to protect a cosmetic layer. It is surfaced rather than swallowed
   * because a `true` here means something upstream wrote a bad object, and T6 still holds
   * the real days for an AP-17 repair to restore.
   */
  sidecarRebuilt: boolean
}

const isNoSuchKey = (e: unknown): boolean => {
  const x = e as S3ServiceException | undefined
  return x?.name === "NoSuchKey" || x?.name === "NotFound" || x?.$metadata?.httpStatusCode === 404
}

const isPreconditionFailed = (e: unknown): boolean => {
  const x = e as S3ServiceException | undefined
  return x?.name === "PreconditionFailed" || x?.$metadata?.httpStatusCode === 412
}

async function getBytes(
  key: string,
  deps: BlobStoreDeps,
): Promise<{ bytes: Uint8Array; etag?: string } | undefined> {
  try {
    const out = await deps.s3.send(new GetObjectCommand({ Bucket: deps.bucket, Key: key }))
    const raw = await out.Body?.transformToByteArray()
    if (raw === undefined) throw new Error(`getBytes: ${key} returned no body`)
    return { bytes: raw, etag: out.ETag }
  } catch (e) {
    if (isNoSuchKey(e)) return undefined
    throw e
  }
}

/**
 * S3 stores what it is given. `Content-Encoding: gzip` is a promise to the BROWSER; a
 * `GetObject` from a Lambda gets the compressed bytes back untouched, so every read of an
 * object this module wrote goes through here.
 */
const gunzipIfNeeded = (bytes: Uint8Array): Uint8Array =>
  bytes[0] === 0x1f && bytes[1] === 0x8b ? new Uint8Array(gunzipSync(bytes)) : bytes

/** `undefined` rather than a throw. See `RegenerateResult.sidecarRebuilt`. */
function tryDecodeLastRun(bytes: Uint8Array): LastRunBlob | undefined {
  try {
    return decodeLastRunBlob(bytes)
  } catch (e) {
    if (e instanceof BlobFormatError) return undefined
    throw e
  }
}

export async function readManifest(
  userId: string,
  deps: BlobStoreDeps,
): Promise<{ manifest: ExploredManifest; etag?: string } | undefined> {
  const got = await getBytes(objectKeys.manifest(userId), deps)
  if (got === undefined) return undefined
  const manifest = JSON.parse(Buffer.from(got.bytes).toString("utf8")) as ExploredManifest
  if (manifest.res !== RES) {
    throw new Error(
      `readManifest: ${userId}'s manifest declares res ${manifest.res}, expected ${RES} ` +
        "(D-115). Refusing to merge across resolutions.",
    )
  }
  return { manifest, etag: got.etag }
}

/**
 * THE HOT PATH. Merge this activity's cells into the previous generation and publish.
 *
 * @param touched EVERY cell the activity crossed, not only the new ones. The set decides
 *                which entries of the sidecar advance their `lastRunDay`; the merge itself
 *                works out which were actually new. Passing only the new ones would leave
 *                re-run ground permanently stamped with the day it was first discovered,
 *                and the cold-territory overlay (D-133) reads exactly that field.
 * @param day     `lastRunDay(activity.startedAt)` — days since 2020-01-01. **From the
 *                activity's own clock, never `now()`** (I-12), for the same reason the cell
 *                writes use it: a run uploaded three days late must age from when it
 *                happened.
 */
export async function regenerateExplored(
  input: { userId: string; touched: Iterable<H3Index>; day: number },
  deps: BlobStoreDeps,
): Promise<RegenerateResult> {
  const { userId } = input
  const maxAttempts = deps.maxAttempts ?? 3
  const touchedBig = new Set([...input.touched].map(cellToBig))

  for (let attempt = 0; ; attempt++) {
    const prior = await readManifest(userId, deps)
    const previousGeneration = prior?.manifest.generation ?? 0

    /**
     * The base. A user with no manifest is a first ingest, not an error — the empty set
     * merges exactly like a full one, which is why there is no bootstrap branch below.
     */
    let baseCells: bigint[] = []
    let baseDays: Uint16Array = new Uint16Array(0)
    let sidecarRebuilt = false

    if (prior !== undefined) {
      const cellsObj = await getBytes(objectKeys.cells(userId, previousGeneration), deps)
      if (cellsObj === undefined) {
        throw new Error(
          `regenerateExplored: manifest for ${userId} names generation ${previousGeneration} ` +
            "but its cell blob is missing. Refusing to publish a generation built on nothing — " +
            "this is an AP-17 repair, not something the ingest path may paper over.",
        )
      }
      const decoded = decodeExploredBlob(gunzipIfNeeded(cellsObj.bytes))
      baseCells = decoded.cells

      /**
       * The check the header exists for (D-219). A sidecar whose count or generation
       * disagrees with the set is not "slightly stale", it is misaligned at every index past
       * the first insertion — so it is dropped and rebuilt from zero rather than merged.
       * Dropping loses history the table still holds; merging would write a lie into an
       * object served `immutable`.
       *
       * A sidecar that does not decode at all lands in the same branch, for the reason
       * `sidecarRebuilt` documents: this object feeds one optional overlay, and a corrupt
       * one must not be able to stop the map updating.
       */
      const lastRunObj = await getBytes(objectKeys.lastRun(userId, previousGeneration), deps)
      const sidecar = lastRunObj && tryDecodeLastRun(gunzipIfNeeded(lastRunObj.bytes))
      if (sidecar && sidecar.generation === previousGeneration && sidecar.days.length === baseCells.length) {
        baseDays = sidecar.days
      } else {
        sidecarRebuilt = true
      }
    }

    const merged = mergeCells(baseCells, touchedBig)
    const days = mergeLastRunDays(baseDays, merged, touchedBig, input.day)

    /**
     * ALLOCATED HERE, as late as possible and still before any object is named. Earlier
     * would burn a number on every lost race; later is impossible, because `<gen>` is in
     * three filenames.
     */
    const generation = await bumpGeneration(userId, deps)
    const agg = computeAgg(merged.cells, generation)

    await putImmutable(
      objectKeys.cells(userId, generation),
      encodeExploredBlob(merged.cells, generation),
      "application/octet-stream",
      deps,
    )
    await putImmutable(
      objectKeys.lastRun(userId, generation),
      encodeLastRunBlob(days, generation),
      "application/octet-stream",
      deps,
    )
    await putImmutable(
      objectKeys.agg(userId, generation),
      Buffer.from(JSON.stringify(agg)),
      "application/json",
      deps,
    )
    /**
     * The delta, for a tab that is already open (§7.4). Written even when it is empty:
     * `addedCount: 0` is a real and common answer — a run over entirely known ground — and
     * a client that has to distinguish "no new cells" from "the object is missing, fall
     * back to the full 300 KB fetch" would take the expensive branch on the cheapest case.
     */
    await putImmutable(
      objectKeys.delta(userId, previousGeneration, generation),
      encodeDeltaBlob(merged.added, previousGeneration, generation),
      "application/octet-stream",
      deps,
    )

    const manifest: ExploredManifest = {
      generation,
      res: RES,
      cellCount: merged.cells.length,
      updatedAt: (deps.now?.() ?? new Date()).toISOString(),
      cells: objectKeys.cells(userId, generation),
      agg: objectKeys.agg(userId, generation),
      lastRun: objectKeys.lastRun(userId, generation),
      /**
       * The chain reaches back to the generation this one was built on. `0051` owns the GC
       * that walks it forward as old deltas are dropped; until then a client is always at
       * most one hop behind, which is the case §6.5 calls common.
       */
      deltasFrom: previousGeneration,
    }

    try {
      await deps.s3.send(
        new PutObjectCommand({
          Bucket: deps.bucket,
          Key: objectKeys.manifest(userId),
          Body: Buffer.from(JSON.stringify(manifest, null, 2)),
          ContentType: "application/json",
          CacheControl: MANIFEST_CACHE_CONTROL,
          /**
           * THE COMMIT. `IfMatch` on the ETag the base was read from — or `IfNoneMatch: "*"`
           * when there was no manifest, which is the same precondition spelled for a key
           * that must not yet exist. A 412 means another worker published while this one was
           * merging, and the merge is redone against what it published.
           */
          ...(prior?.etag !== undefined ? { IfMatch: prior.etag } : { IfNoneMatch: "*" }),
        }),
      )
    } catch (e) {
      if (isPreconditionFailed(e) && attempt < maxAttempts) continue
      if (isPreconditionFailed(e)) {
        throw new Error(
          `regenerateExplored: lost the manifest race ${attempt + 1} times for ${userId}. ` +
            "The cells are already in T6, so nothing is lost — a redelivery republishes.",
          { cause: e },
        )
      }
      throw e
    }

    return {
      generation,
      previousGeneration,
      cellCount: merged.cells.length,
      addedCount: merged.added.length,
      conflicts: attempt,
      sidecarRebuilt,
    }
  }
}

/**
 * Every `<gen>`-named object, written the same way: gzipped, and `immutable` for a year.
 *
 * **`immutable` is only safe because the name carries the generation** (`02` §6.1) — a
 * generation is never rewritten, so no cache anywhere (browser, IndexedDB, CloudFront) can
 * ever be wrong and nothing needs purging. Every guard in this module about unique
 * generation numbers is ultimately defending this one header.
 *
 * gzip earns its place even though delta+LEB128 has already removed most of the redundancy
 * (`02` §6.2 is explicit that the two figures *"sit on top of each other rather than a
 * factor apart"*): it costs nothing, S3 stores the compressed object, CloudFront passes it
 * through, and it does compress the agg JSON and the long runs of identical small deltas
 * through dense grid territory.
 */
async function putImmutable(
  key: string,
  body: Uint8Array,
  contentType: string,
  deps: BlobStoreDeps,
): Promise<void> {
  await deps.s3.send(
    new PutObjectCommand({
      Bucket: deps.bucket,
      Key: key,
      Body: gzipSync(body),
      ContentType: contentType,
      ContentEncoding: "gzip",
      CacheControl: IMMUTABLE_CACHE_CONTROL,
    }),
  )
}

/** Re-exported so a reader of a manifest does not need to know which module shapes it. */
export type { ExploredAgg }
