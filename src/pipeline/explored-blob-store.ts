import { gunzipSync, gzipSync } from "node:zlib"

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3ServiceException,
} from "@aws-sdk/client-s3"
import type { H3Index } from "h3-js"

import { computeAgg, type ExploredAgg } from "@/src/domain/explored-agg"
import {
  BlobFormatError,
  bigToCell,
  cellToBig,
  decodeExploredBlob,
  decodeLastRunBlob,
  encodeDeltaBlob,
  decodeDeltaBlob,
  encodeExploredBlob,
  encodeLastRunBlob,
  mergeCells,
  mergeLastRunDays,
  type DeltaBlob,
  type LastRunBlob,
} from "@/src/domain/explored-blob"
import { RES } from "@/src/domain/fog"

import { bumpGeneration, type GenerationDeps } from "./explored-generation"
import { mirrorGeneration, type MirrorDeps, type MirrorOutcome } from "./explored-mirror"

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
  /**
   * NAMED BY `toGen` ALONE, and `05` §7.3 tabulates it as `<fromGen>-<toGen>.bin`. D-220.
   *
   * A client only ever knows the `from` end — its own cached generation — so it cannot build
   * a two-ended key without already knowing the answer. The documented name works for the
   * single hop the manifest spells out (`deltasFrom` → `generation`) and makes §7.4's *"chain
   * multiple deltas if the client is several generations behind"* unimplementable.
   *
   * Named by `toGen`, the chain walks BACKWARDS and needs nothing but the manifest: fetch the
   * delta for `manifest.generation`, read its `fromGen` out of the LSFD header, and repeat
   * until it matches the cached generation or falls below `deltasFrom`. That also survives the
   * gaps D-219's counter introduces — a generation burned by a lost manifest race leaves no
   * object, and an arithmetic guess of `from + 1` would land on it.
   */
  delta: (userId: string, toGen: number) => `users/${userId}/deltas/${toGen}.bin`,
  /**
   * THE PER-RUN CELL RECORD. `02` §8.3 step 4, ticket `0050`.
   *
   * *Written there as `cells/<uid>/<activityId>.cells.bin` — a top-level prefix that no other
   * per-user object uses.* Everything else the user owns lives under `users/<uid>/` (`02` §6.1,
   * `05` §7.3, including `traces/`), and the worker's S3 grant is scoped to that prefix, so a
   * top-level `cells/` would need a third grant for no reason. Corrected in §8.3.
   */
  runCells: (userId: string, activityId: string) => `users/${userId}/cells/${activityId}.bin`,
}

/**
 * How many generations of delta to keep. `02` §6.5, `05` §7.3: *"~20 generations"*, and
 * `manifest.deltasFrom` tells a client when the chain no longer reaches it.
 *
 * A client further back than this takes the full immutable GET, which `02` §6.5 already calls
 * *"the correct outcome"* for a client that has been closed for a month.
 */
export const DELTA_CHAIN_KEEP = 20

/**
 * The delta objects that fall out of the window when `previousGeneration` becomes `generation`.
 *
 * **Arithmetic, not a listing or a walk**, which is what keeps GC O(1) on the hot path — the
 * alternative is ~20 sequential GETs per publish to read each hop's header, 19 of them
 * no-ops. It is a RANGE rather than a single number because the counter can skip: a worker
 * that loses the manifest race burns its allocation, so 41 → 44 is reachable and deleting only
 * `generation - KEEP` would leak the numbers in between. The range is `generation −
 * previousGeneration` wide, which is 1 in the ordinary case.
 *
 * A key that names a burned generation simply does not exist, and deleting it is a no-op.
 * Erring that way is deliberate: burned numbers make the retained chain slightly LONGER than
 * 20 hops, never shorter, and a chain that reaches further than advertised costs nothing.
 */
export function expiringDeltaGenerations(
  previousGeneration: number,
  generation: number,
): number[] {
  const out: number[] = []
  for (let g = previousGeneration - DELTA_CHAIN_KEEP + 1; g <= generation - DELTA_CHAIN_KEEP; g++) {
    if (g >= 1) out.push(g)
  }
  return out
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
  send(command: DeleteObjectCommand): Promise<unknown>
}

export interface BlobStoreDeps extends GenerationDeps {
  s3: BlobStoreS3
  bucket: string
  /**
   * The `Profile.exploredGeneration` mirror (`0051`, `02` §6.4, T1). Optional, and its
   * `table` is optional in turn: T1 does not exist yet, and a mirror with nowhere to write
   * reports `"no-table"` rather than throwing.
   */
  mirror?: MirrorDeps
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
  /** Delta objects dropped out of the ~20-generation window by this publish. */
  deltasExpired: number
  /**
   * What the `Profile.exploredGeneration` mirror did. `"no-table"` until T1 exists — the
   * manifest is authoritative and the mirror is only the AppSync subscription's push channel
   * (`02` §6.4), so its absence costs nothing today.
   */
  mirrored: MirrorOutcome
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
      objectKeys.delta(userId, generation),
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
       * THE OLDEST GENERATION THE CHAIN STILL REACHES. `02` §6.4 step 4: a client whose
       * cached generation is at or above this walks the deltas; below it, it takes the full
       * blob.
       *
       * It is `generation − KEEP` and not `previousGeneration`, because the chain is now
       * walkable (D-220) and GC only ever deletes hops at or below `generation − KEEP`. A
       * client cached exactly here needs the hops ABOVE it, all of which survive; one cached
       * a step lower needs the hop just deleted, and is correctly told to refetch.
       */
      deltasFrom: Math.max(0, generation - DELTA_CHAIN_KEEP),
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

    /**
     * ─── EVERYTHING BELOW HERE IS AFTER THE COMMIT POINT ────────────────────
     *
     * The manifest has landed, so the client is already correct. GC and the mirror are
     * housekeeping, and **neither may fail the publish**: a delete that 403s or a mirror
     * write that throws must not turn a completed publish into a redelivery, because the
     * redelivery would allocate a fresh generation and republish an identical map.
     */
    const deltasExpired = await expireDeltas(userId, previousGeneration, generation, deps)
    const mirrored = await mirrorGeneration(userId, generation, deps.mirror)

    return {
      generation,
      previousGeneration,
      cellCount: merged.cells.length,
      addedCount: merged.added.length,
      conflicts: attempt,
      sidecarRebuilt,
      deltasExpired,
      mirrored,
    }
  }
}

/**
 * DROP THE DELTAS THAT FELL OUT OF THE WINDOW. `02` §6.5, `05` §7.3 — *"garbage-collected at
 * ~20 generations"*.
 *
 * ─── AFTER THE MANIFEST, AND IT CANNOT FAIL THE PUBLISH ─────────────────────
 *
 * The manifest already names `deltasFrom`, so a client is correct the instant it commits —
 * these objects are past the window and nothing will ask for them again. A delete that fails
 * therefore costs an orphan object, and orphans are already what `02` §6.4 calls harmless.
 * Throwing here would cost far more: the receipt is still `PROCESSING`, so the redelivery
 * would allocate a NEW generation and republish an identical map, permanently, on every
 * attempt. The failure is returned as a count rather than swallowed silently.
 *
 * ─── WHAT A DELETE ACTUALLY DOES HERE ───────────────────────────────────────
 *
 * The bucket is versioned, so this writes a delete marker rather than destroying bytes, and
 * `s3:DeleteObjectVersion` is denied bucket-wide. Even a bug in this function cannot lose
 * anything — and nothing under `users/` is a system of record in any case: every object here
 * is re-derivable from `raw/` plus T6 (§1.1). That is the whole reason the delivery layer gets
 * a delete grant and `raw/*` never will (I-3).
 */
async function expireDeltas(
  userId: string,
  previousGeneration: number,
  generation: number,
  deps: BlobStoreDeps,
): Promise<number> {
  let deleted = 0
  for (const gen of expiringDeltaGenerations(previousGeneration, generation)) {
    try {
      await deps.s3.send(
        new DeleteObjectCommand({ Bucket: deps.bucket, Key: objectKeys.delta(userId, gen) }),
      )
      deleted++
    } catch {
      // See above: an undeleted delta is an orphan, and an orphan is cheaper than a
      // republish loop. S3 answers a delete of a missing key with 204, so this is a real
      // failure rather than the ordinary burned-generation case.
    }
  }
  return deleted
}

/**
 * WALK THE CHAIN BACKWARDS. D-220, `05` §7.4, `02` §6.5.
 *
 * The client's algorithm, server-side: from `manifest.generation`, fetch each delta, read the
 * `fromGen` out of its header, and repeat until the cached generation is reached. Returns the
 * hops in APPLICATION order — oldest first — because that is the order they must be merged in.
 *
 * It lives here rather than only in `0054` for a reason that outlives the client: it is the
 * executable proof that the objects this module writes are walkable at all, which is the
 * entire content of D-220. A rename back to a two-ended key would break this function rather
 * than break a browser three tickets later.
 *
 * @returns `undefined` when the chain does not reach — a hop is missing, or `cachedGeneration`
 *          is below `deltasFrom`. The caller's answer is always the same: take the full blob.
 */
export async function readDeltaChain(
  userId: string,
  cachedGeneration: number,
  deps: BlobStoreDeps,
): Promise<DeltaBlob[] | undefined> {
  const prior = await readManifest(userId, deps)
  if (prior === undefined) return undefined
  const { generation, deltasFrom } = prior.manifest

  if (cachedGeneration === generation) return []
  if (cachedGeneration < deltasFrom || cachedGeneration > generation) return undefined

  const hops: DeltaBlob[] = []
  let at = generation
  // Bounded by the retention window, so a corrupt `fromGen` cannot loop forever.
  for (let i = 0; i <= DELTA_CHAIN_KEEP; i++) {
    const object = await getBytes(objectKeys.delta(userId, at), deps)
    if (object === undefined) return undefined
    const hop = decodeDeltaBlob(gunzipIfNeeded(object.bytes))
    hops.unshift(hop)
    if (hop.fromGen === cachedGeneration) return hops
    if (hop.fromGen >= at) return undefined // not descending; refuse rather than spin
    at = hop.fromGen
  }
  return undefined
}

/**
 * WHAT THIS RUN COVERED, KEPT. `02` §8.3 step 4; `05` §3.5; ticket `0050`.
 *
 * ─── WHY THE FOLD MAY NOT RE-DERIVE GEOMETRY ────────────────────────────────
 *
 * `05` §3.5 gives one reason: *"`store.appendCellsToRun(activity.id, cells)` exists precisely
 * so un-award is possible without re-deriving geometry."* An edited activity has to have its
 * previous contribution subtracted, and by then the previous trace is gone.
 *
 * There is a second and larger one. A replay or a drill that re-projected each trace would do
 * it under **today's** `fogAlgoVersion`, silently rewriting what history was. `02` §8.3 step 4
 * is careful about this — it projects at the current version and stores the result, so every
 * later step folds the same facts rather than recomputing them. This object is those facts.
 *
 * ─── SAME FORMAT AS THE PUBLISHED SET, WITH GENERATION 0 ────────────────────
 *
 * `LSFG`, because it is the same thing: a sorted cell set. `generation` is 0, which is a
 * SENTINEL and not a coincidence — `bumpGeneration` returns 1 on a user's first ever call and
 * only increases, so no published generation is ever 0 and a per-run record can never be
 * mistaken for one. That also means every decoder's `res` and `version` checks apply here for
 * free.
 *
 * NOT `immutable`, and not versioned by generation: an activity may legitimately be re-scored
 * after a revision (§3.5), and the newest projection of a given activity is the only one
 * anybody wants. Nothing caches this — the browser never fetches it.
 */
export async function appendCellsToRun(
  userId: string,
  activityId: string,
  cells: Iterable<H3Index>,
  deps: BlobStoreDeps,
): Promise<number> {
  const sorted = [...new Set([...cells].map(cellToBig))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  await deps.s3.send(
    new PutObjectCommand({
      Bucket: deps.bucket,
      Key: objectKeys.runCells(userId, activityId),
      Body: gzipSync(encodeExploredBlob(sorted, 0)),
      ContentType: "application/octet-stream",
      ContentEncoding: "gzip",
      CacheControl: "no-store",
    }),
  )
  return sorted.length
}

/** The un-award path's and the fold's read. `undefined` when the activity was never scored. */
export async function readRunCells(
  userId: string,
  activityId: string,
  deps: BlobStoreDeps,
): Promise<H3Index[] | undefined> {
  const object = await getBytes(objectKeys.runCells(userId, activityId), deps)
  if (object === undefined) return undefined
  return decodeExploredBlob(gunzipIfNeeded(object.bytes)).cells.map(bigToCell)
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
