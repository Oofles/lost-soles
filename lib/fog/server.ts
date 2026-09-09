import { gunzipSync } from "node:zlib"

import { GetObjectCommand, S3Client, type S3ServiceException } from "@aws-sdk/client-s3"

import outputs from "@/amplify_outputs.json"
import { decodeDeltaBlob } from "@/src/domain/explored-blob"
import { RES } from "@/src/domain/fog"
import { DELTA_CHAIN_KEEP, objectKeys, type ExploredManifest } from "@/src/pipeline/explored-blob-store"

import type { FogUpdate } from "./wire"

/**
 * THE SERVER HALF OF THE DELIVERY CONTRACT. Ticket `0054`. `05-fog-of-war.md` §7.3, §7.4;
 * `02-data-model.md` §6.4, §6.5.
 *
 * Reads the manifest the ingest worker published, resolves the client's cached generation
 * into one of four plans, and — on the delta path — assembles the chain. It holds no
 * state and caches nothing: the manifest is the authority (`02` §6.4) and it is read on
 * every request, which is what `no-cache` on that object has always meant.
 *
 * ─── WHY THIS EXISTS AT ALL, WHEN THE DESIGN SAYS THE BROWSER GETS A URL ────
 *
 * See `wire.ts`. Two reasons, and the second is a hard blocker: the delta chain is walked
 * backwards (D-220), so presigning it is one round trip per hop; and the browser's S3
 * grant is scoped to `users/{entity_id}/*` — the identity-pool id — while the worker
 * writes `users/<cognito-sub>/…`. A browser has never been able to read these objects.
 * D-228.
 *
 * ─── THE UID IS NEVER A PARAMETER FROM THE REQUEST ──────────────────────────
 *
 * `08-security-privacy.md` §5.3: every route re-derives `sub` from the verified session.
 * The `userId` below comes from `currentUserId()` and from nowhere else. This module
 * cannot enforce that — the route can, and does — so it is stated here as the contract a
 * second caller must also keep.
 */

/**
 * THE BUCKET, FROM `amplify_outputs.json`.
 *
 * The SSR compute has no CloudFormation output of its own and no environment variable a
 * CDK stack can set — the same structural gap `app/sync-action.ts` documents for the
 * queue URL. A bucket NAME is not a secret; possessing it grants nothing without the
 * `s3:GetObject` statement `amplify/backend.ts` gives the compute role.
 *
 * Read structurally, because this file is generated per environment: the deployed copy
 * has a real name, a laptop's `ampx sandbox` copy names the sandbox bucket, and CI copies
 * `amplify_outputs.example.json`. A loud failure is the only behaviour that is the same
 * in all three.
 */
function bucketName(): string {
  const name = (outputs as { storage?: { bucket_name?: string } }).storage?.bucket_name
  if (!name) {
    throw new Error(
      "amplify_outputs.json has no storage.bucket_name. It is written by defineStorage " +
        "in amplify/storage/resource.ts; a missing value means this build has no backend.",
    )
  }
  return name
}

/** Module scope, so a warm SSR container reuses the connection rather than opening TLS per load. */
let cached: S3Client | undefined
const client = (): S3Client => (cached ??= new S3Client({}))

export interface FogReadDeps {
  s3: Pick<S3Client, "send">
  bucket: string
}

export const defaultFogReadDeps = (): FogReadDeps => ({ s3: client(), bucket: bucketName() })

const isMissing = (error: unknown): boolean => {
  const e = error as S3ServiceException | undefined
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404
}

/**
 * `Content-Encoding: gzip` is a promise to the BROWSER. A `GetObject` from a server gets
 * the compressed bytes back untouched, so every object this project writes immutably has
 * to come back through here. `explored-blob-store.ts` carries the same function for the
 * same reason; the alternative is a decoder that fails on a gzip magic number and reports
 * it as a corrupt blob.
 */
const gunzipIfNeeded = (bytes: Uint8Array): Uint8Array =>
  bytes[0] === 0x1f && bytes[1] === 0x8b ? new Uint8Array(gunzipSync(bytes)) : bytes

export async function getObject(key: string, deps: FogReadDeps): Promise<Uint8Array | undefined> {
  try {
    const out = await deps.s3.send(new GetObjectCommand({ Bucket: deps.bucket, Key: key }))
    const body = await out.Body?.transformToByteArray()
    return body === undefined ? undefined : gunzipIfNeeded(body)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

export async function readManifest(
  userId: string,
  deps: FogReadDeps,
): Promise<ExploredManifest | undefined> {
  const bytes = await getObject(objectKeys.manifest(userId), deps)
  if (bytes === undefined) return undefined
  return JSON.parse(new TextDecoder().decode(bytes)) as ExploredManifest
}

/**
 * THE CHAIN, IN BYTES. `05` §7.4, D-220.
 *
 * Walks BACKWARDS from `manifest.generation`, reading each hop's `fromGen` out of its own
 * `LSFD` header, and returns the hops in APPLICATION order — oldest first.
 *
 * ─── WHY THIS IS NOT `readDeltaChain` FROM THE PIPELINE ─────────────────────
 *
 * `explored-blob-store.ts` already walks this chain, and deliberately: `0051` put it there
 * as the executable proof that the objects it writes are walkable at all. But it returns
 * DECODED hops and throws the bytes away, and the bytes are the thing that must reach the
 * browser — `02` §6.5 requires the CLIENT to validate `fromGen === state.generation`
 * before applying each one. Re-encoding a decoded hop would mean the client validated a
 * payload this server had assembled, which is a different and weaker claim.
 *
 * The decode below is therefore a check, not a conversion: it proves the hop is a
 * well-formed `LSFD` at res 10 before it is handed on, so a corrupt object is a full
 * fetch here rather than a refusal to render in the browser.
 *
 * @returns `undefined` when the chain does not reach — a hop is missing, an object is
 *          corrupt, or the chain grew larger than the blob it exists to avoid. The
 *          caller's answer is always the same: the full blob.
 */
/** See the guard inside. Roughly a quarter of R3's pessimistic five-year blob. */
export const MAX_CHAIN_BYTES = 256 * 1024

export async function readDeltaChainBytes(
  userId: string,
  since: number,
  generation: number,
  deps: FogReadDeps,
): Promise<Uint8Array[] | undefined> {
  const hops: Uint8Array[] = []
  let total = 0
  let at = generation

  // Bounded by the retention window, so a corrupt `fromGen` cannot loop forever.
  for (let i = 0; i <= DELTA_CHAIN_KEEP; i++) {
    const bytes = await getObject(objectKeys.delta(userId, at), deps)
    if (bytes === undefined) return undefined

    let hop
    try {
      hop = decodeDeltaBlob(bytes)
    } catch {
      return undefined
    }

    hops.unshift(bytes)
    total += bytes.length
    /**
     * THE SIZE GUARD, and it is not a tuning knob.
     *
     * `02` §6.5: *"the incremental path exists so the CLIENT WORK stays small, not to save
     * bandwidth"* — a typical hop is 100–350 bytes. A chain that has grown past a quarter
     * of a megabyte is no longer that: it means an unusual backfill landed, and at that
     * point the full immutable blob is smaller, cached by the browser, and one merge
     * instead of twenty. Falling back is strictly better on every axis, so the guard
     * fires rather than being tuned.
     */
    if (total > MAX_CHAIN_BYTES) return undefined

    if (hop.fromGen === since) return hops
    if (hop.fromGen >= at) return undefined // not descending; refuse rather than spin
    at = hop.fromGen
  }
  return undefined
}

/**
 * THE THREE-WAY BRANCH OF `02` §6.4, PLUS THE CASE IT DOES NOT MENTION.
 *
 * §6.4 steps 3–5 assume a user who has ingested at least one activity. A user who has
 * not has no manifest at all, and `plan: "empty"` is that — an explored set of size zero,
 * which is a correct and renderable answer (full fog, no revealed ground) rather than an
 * error. Answering `full` instead would send the client after a blob that does not exist.
 *
 * `since` is the client's cached generation; **0 means nothing is cached**. That sentinel
 * is safe because `bumpGeneration` returns 1 on a user's first ever call and only
 * increases (I-11), so no published generation is ever 0.
 */
export async function resolveFogUpdate(
  userId: string,
  since: number,
  deps: FogReadDeps,
): Promise<FogUpdate> {
  const manifest = await readManifest(userId, deps)
  if (manifest === undefined) {
    return { generation: 0, res: RES, cellCount: 0, deltasFrom: 0, plan: "empty" }
  }

  const base = {
    generation: manifest.generation,
    /**
     * ECHOED, NOT ASSERTED. `explored-blob-store.ts`'s own `readManifest` throws on a res
     * mismatch, which is right for a worker about to merge. Here the client is the one
     * that must refuse (`02` §6.4, criterion 8), and it can only refuse over a value it
     * has been told. Throwing would send a 500 and produce a blank map with no message.
     */
    res: manifest.res,
    cellCount: manifest.cellCount,
    deltasFrom: manifest.deltasFrom,
  }

  if (since === manifest.generation && since > 0) return { ...base, plan: "up-to-date" }

  /**
   * A client AHEAD of the manifest takes the full blob. It should be unreachable — the
   * counter only increases — but the reachable way to get here is a restored bucket or an
   * AP-17 repair, and the honest answer to "my cache is newer than the server's" is to
   * replace the cache, never to trust it.
   */
  const reaches = since > 0 && since >= manifest.deltasFrom && since < manifest.generation
  if (reaches) {
    const hops = await readDeltaChainBytes(userId, since, manifest.generation, deps)
    if (hops) {
      return {
        ...base,
        plan: "delta",
        deltas: hops.map((hop) => Buffer.from(hop).toString("base64")),
      }
    }
  }

  return { ...base, plan: "full" }
}
