import { createHash } from "node:crypto"

import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"

import { assertNormalizeIsPure } from "@/src/adapters/normalize-purity"
import type { IngestJob, SourceAdapter } from "@/src/adapters/types"
import type { Activity, RawArchiveRef, SourceId, Trace } from "@/src/domain/activity"
import { computeActivityId } from "@/src/domain/activity-id"
import { foldOrder } from "@/src/domain/fold"
import { objectKeys } from "@/src/pipeline/explored-blob-store"
import { applyKindOverride, type KindCorrected, type KindOverride } from "@/src/pipeline/kind-override"
import { snapshotPrefix, type SkillStateSnapshot } from "@/src/pipeline/skillstate-snapshot"

/**
 * THE REBUILD DRILL, FRONT HALF: PRECONDITIONS, STEP 0, AND STEPS 1–3. Ticket `0102`.
 * `02-data-model.md` §8.3, D-101, D-121.
 *
 * D-101 says `raw/` is the system of record and everything else is reconstructible. This module is
 * the first half of the procedure that proves it: list the bucket, normalize every archived payload
 * through the shipped adapter, and put the result in fold order. Nothing here writes to AWS. The
 * back half (steps 4–8, ticket `0103`, `rebuild-drill-back.ts`) takes `FrontHalf.sorted` and does
 * the order-dependent work.
 *
 * ─── STEP 1 NEEDS NOTHING BUT THE BUCKET ───────────────────────────────────
 *
 * The key is `raw/<uid>/<source>/<externalId>/<sha256>.<ext>` (`archive.ts`), so who, where from,
 * which activity and which bytes all come out of the path. `enumerateRaw` takes an S3 surface and
 * nothing else; there is no table handle in its signature to reach for.
 *
 * ─── NOT EVERY KEY IS A PAYLOAD ─────────────────────────────────────────────
 *
 * Two kinds of correction sit beside an activity's prefix (§8.3 step 1):
 * `<externalId>.duplicate-of.json` (D-263, `dedupe.ts`) and `<externalId>.kind-override/<id>.json`
 * (D-284, `kind-override.ts`). The override has the same depth as a payload, so keys are classified
 * on the shape of the externalId and file segments, never on depth. Anything else is reported as
 * unrecognised and kept away from `normalize()`.
 *
 * ─── MORE THAN ONE PAYLOAD PER ACTIVITY ─────────────────────────────────────
 *
 * The archive is content-addressed, so a re-fetch that returned different bytes lands a second
 * object under the same activity (`archive.ts`). Every one is sha-checked and normalized, because a
 * corrupt object anywhere in the system of record is worth knowing about. Only the NEWEST is emitted,
 * by `LastModified` with the key as tie-break: the same rule `replay.ts` uses, and the bytes the most
 * recent ingest actually scored. Emitting both would put two rows with one `activityId` into the
 * fold, where their relative order is undefined.
 */

// ─── Step 1: classify and enumerate ─────────────────────────────────────────

export interface ActivityAddress {
  userId: string
  source: SourceId
  externalId: string
}

export type RawKey =
  | (ActivityAddress & { kind: "payload"; key: string; sha256: string; ext: string })
  | (ActivityAddress & { kind: "kind-override"; key: string; id: string })
  | (ActivityAddress & { kind: "duplicate-pointer"; key: string })
  | { kind: "unrecognised"; key: string; reason: string }

const SHA256_FILE = /^([0-9a-f]{64})\.([A-Za-z0-9]+)$/
const KIND_OVERRIDE_DIR = ".kind-override"
const DUPLICATE_POINTER = ".duplicate-of.json"

/** What a key under `raw/<userId>/` is, from the path alone. */
export function classifyRawKey(key: string, userId: string): RawKey {
  const parts = key.split("/")
  if (parts[0] !== "raw" || parts[1] !== userId) {
    return { kind: "unrecognised", key, reason: `not under raw/${userId}/` }
  }
  const source = parts[2]
  if (!source) return { kind: "unrecognised", key, reason: "no source segment" }

  if (parts.length === 4) {
    const file = parts[3]!
    if (file.endsWith(DUPLICATE_POINTER) && file.length > DUPLICATE_POINTER.length) {
      return {
        kind: "duplicate-pointer",
        key,
        userId,
        source,
        externalId: file.slice(0, -DUPLICATE_POINTER.length),
      }
    }
    return { kind: "unrecognised", key, reason: "four segments, not a duplicate-of pointer" }
  }

  if (parts.length === 5) {
    const segment = parts[3]!
    const file = parts[4]!
    if (segment.endsWith(KIND_OVERRIDE_DIR)) {
      if (!file.endsWith(".json") || segment.length === KIND_OVERRIDE_DIR.length) {
        return { kind: "unrecognised", key, reason: "malformed kind-override key" }
      }
      return {
        kind: "kind-override",
        key,
        userId,
        source,
        externalId: segment.slice(0, -KIND_OVERRIDE_DIR.length),
        id: file.slice(0, -".json".length),
      }
    }
    const m = SHA256_FILE.exec(file)
    if (!segment || !m) {
      return { kind: "unrecognised", key, reason: "five segments, file is not <sha256>.<ext>" }
    }
    return { kind: "payload", key, userId, source, externalId: segment, sha256: m[1]!, ext: m[2]! }
  }

  return { kind: "unrecognised", key, reason: `${parts.length} path segments` }
}

export interface PayloadObject extends ActivityAddress {
  key: string
  sha256: string
  ext: string
  lastModified: Date
  activityId: string
}

export interface Enumeration {
  userId: string
  /** EVERY object under `raw/<uid>/` — the figure `aws s3 ls --recursive --summarize` prints. */
  objectCount: number
  payloads: PayloadObject[]
  /** `activityId` → the newest override key (greatest key: the id is time-first, D-284). */
  kindOverrides: Map<string, string>
  kindOverrideObjectCount: number
  /** `activityId` → pointer key. Carried to `0103`; step 8 check 2 subtracts these. */
  duplicatePointers: Map<string, string>
  unrecognised: Array<{ key: string; reason: string }>
  /** Distinct sources, from payload key paths only, sorted. */
  sourceIds: SourceId[]
}

/** Step 1 over a listing already in hand. Pure: the test and `enumerateRaw` share it. */
export function enumerationFromListing(
  userId: string,
  listing: ReadonlyArray<{ key: string; lastModified: Date }>,
): Enumeration {
  const payloads: PayloadObject[] = []
  const kindOverrides = new Map<string, string>()
  const duplicatePointers = new Map<string, string>()
  const unrecognised: Array<{ key: string; reason: string }> = []
  const sources = new Set<SourceId>()
  let kindOverrideObjectCount = 0

  for (const { key, lastModified } of listing) {
    const c = classifyRawKey(key, userId)
    switch (c.kind) {
      case "payload": {
        sources.add(c.source)
        payloads.push({
          userId,
          source: c.source,
          externalId: c.externalId,
          key,
          sha256: c.sha256,
          ext: c.ext,
          lastModified,
          activityId: computeActivityId(userId, c.source, c.externalId),
        })
        break
      }
      case "kind-override": {
        kindOverrideObjectCount++
        const id = computeActivityId(userId, c.source, c.externalId)
        const newest = kindOverrides.get(id)
        if (newest === undefined || key > newest) kindOverrides.set(id, key)
        break
      }
      case "duplicate-pointer":
        duplicatePointers.set(computeActivityId(userId, c.source, c.externalId), key)
        break
      case "unrecognised":
        unrecognised.push({ key, reason: c.reason })
        break
    }
  }

  payloads.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return {
    userId,
    objectCount: listing.length,
    payloads,
    kindOverrides,
    kindOverrideObjectCount,
    duplicatePointers,
    unrecognised,
    sourceIds: [...sources].sort(),
  }
}

export interface DrillS3 {
  send(command: ListObjectsV2Command): Promise<{
    Contents?: Array<{ Key?: string; LastModified?: Date }>
    IsTruncated?: boolean
    NextContinuationToken?: string
  }>
  send(command: GetObjectCommand): Promise<{
    Body?: { transformToByteArray(): Promise<Uint8Array> }
    ContentType?: string
  }>
}

export interface DrillS3Deps {
  s3: DrillS3
  bucket: string
}

async function listAll(prefix: string, deps: DrillS3Deps): Promise<Array<{ key: string; lastModified: Date }>> {
  const out: Array<{ key: string; lastModified: Date }> = []
  let token: string | undefined
  do {
    const page = await deps.s3.send(
      new ListObjectsV2Command({ Bucket: deps.bucket, Prefix: prefix, ContinuationToken: token }),
    )
    for (const o of page.Contents ?? []) {
      if (!o.Key) continue
      if (!o.LastModified) throw new Error(`ListObjectsV2 returned ${o.Key} with no LastModified`)
      out.push({ key: o.Key, lastModified: o.LastModified })
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return out
}

/** Step 1. `ListObjectsV2` under `raw/<uid>/`, and nothing else. */
export async function enumerateRaw(userId: string, deps: DrillS3Deps): Promise<Enumeration> {
  return enumerationFromListing(userId, await listAll(`raw/${userId}/`, deps))
}

// ─── Step 2: reconstruct, verify, normalize ─────────────────────────────────

/**
 * The ref `archiveRaw` returned when these bytes landed, rebuilt from the bucket.
 *
 * `archivedAt` is the object's `LastModified`, which is exactly what `archiveRaw` itself returns on
 * a repeat archive (its HEAD path), so a rebuilt `ingestedAt`/`fetchedAt` agrees with a `reingest`
 * of the same object — to the second, as `archive.ts` records. D-196: this is the only clock a pure
 * `normalize()` sees.
 */
export function reconstructRef(
  p: PayloadObject,
  bucket: string,
  body: Buffer,
  contentType: string | undefined,
): RawArchiveRef {
  return {
    bucket,
    key: p.key,
    contentType: contentType ?? "application/octet-stream",
    bytes: body.byteLength,
    sha256: p.sha256,
    archivedAt: p.lastModified.toISOString(),
  }
}

/**
 * The `IngestJob` as far as the key can tell it. `normalize()` reads identity from the job, the
 * clock from the ref, and `revision` from `job.meta` (D-196), where absent means 1 — the same
 * `meta: null` `tools/replay` and `archived-trace.ts` send. `ingestKey` is not read by any
 * `normalize()`, and the real one cannot be rebuilt outside the adapter (`tools/replay`), so it
 * names the object instead of pretending. `enqueuedAt` is the archive instant, not the clock.
 */
export function reconstructJob(p: PayloadObject): IngestJob {
  return {
    ingestKey: `drill:${p.key}`,
    userId: p.userId,
    source: p.source,
    externalId: p.externalId,
    command: "reingest",
    meta: null,
    enqueuedAt: p.lastModified.toISOString(),
  }
}

export interface DrillFailure {
  key: string
  source: SourceId
  error: string
}

export interface DrillEntry {
  activity: KindCorrected
  trace?: Trace
  ref: RawArchiveRef
}

export interface NormalizePhase {
  /** One per activity: the newest payload's result, kind override applied. Unsorted. */
  entries: DrillEntry[]
  failures: DrillFailure[]
  /** Older payloads of an activity that has a newer one. Verified and normalized, not emitted. */
  supersededObjects: number
  kindOverridesApplied: number
}

export interface NormalizeOptions extends DrillS3Deps {
  adapterFor: (source: SourceId) => SourceAdapter
  concurrency?: number
  /** One call per failure. The CLI writes it to stderr as a JSON line. */
  onFailure?: (failure: DrillFailure) => void
}

async function readBytes(deps: DrillS3Deps, key: string): Promise<{ body: Buffer; contentType?: string }> {
  const got = await deps.s3.send(new GetObjectCommand({ Bucket: deps.bucket, Key: key }))
  if (!got.Body) throw new Error(`GetObject ${key} returned no body`)
  return { body: Buffer.from(await got.Body.transformToByteArray()), contentType: got.ContentType }
}

/** Runs `fn` over `items` with at most `limit` in flight. Results keep input order. */
async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * The newest payload per activity: greatest `LastModified`, key as tie-break (`replay.ts`'s rule).
 * Decided from the listing BEFORE anything is normalized, so a newest object that fails is a
 * failure for its activity — never a silent fall back to older bytes.
 */
export function newestPayloads(payloads: readonly PayloadObject[]): Set<string> {
  const best = new Map<string, PayloadObject>()
  for (const p of payloads) {
    const cur = best.get(p.activityId)
    const newer =
      cur === undefined ||
      p.lastModified.getTime() > cur.lastModified.getTime() ||
      (p.lastModified.getTime() === cur.lastModified.getTime() && p.key > cur.key)
    if (newer) best.set(p.activityId, p)
  }
  return new Set([...best.values()].map((p) => p.key))
}

/**
 * Step 2. In parallel and order-independent: per payload, GetObject, check the key's sha256 against
 * the bytes, then `normalize()` under the purity traps (`assertNormalizeIsPure`: `fetch`, `Date.now`,
 * `new Date()` and friends throw, and two calls must agree). A failure fails that object, is
 * reported through `onFailure`, and the run goes on.
 */
export async function normalizeAll(e: Enumeration, opts: NormalizeOptions): Promise<NormalizePhase> {
  const winners = newestPayloads(e.payloads)
  const failures: DrillFailure[] = []
  const fail = (f: DrillFailure) => {
    failures.push(f)
    opts.onFailure?.(f)
  }

  type Normalized = { activity: Activity; trace?: Trace; ref: RawArchiveRef }
  const results = await pool(e.payloads, opts.concurrency ?? 16, async (p): Promise<Normalized | null> => {
    let body: Buffer
    let contentType: string | undefined
    try {
      ;({ body, contentType } = await readBytes(opts, p.key))
    } catch (err) {
      fail({ key: p.key, source: p.source, error: `read failed: ${message(err)}` })
      return null
    }

    const actual = createHash("sha256").update(body).digest("hex")
    if (actual !== p.sha256) {
      fail({ key: p.key, source: p.source, error: `sha256 mismatch: key says ${p.sha256}, bytes hash to ${actual}` })
      return null
    }

    try {
      const ref = reconstructRef(p, opts.bucket, body, contentType)
      const out = assertNormalizeIsPure(opts.adapterFor(p.source), { raw: body, ref, job: reconstructJob(p) })
      if (out.activity.activityId !== p.activityId) {
        throw new Error(`normalize() returned activityId ${out.activity.activityId}; the key implies ${p.activityId}`)
      }
      if (!winners.has(p.key)) return null
      return { activity: out.activity, trace: out.trace, ref }
    } catch (err) {
      fail({ key: p.key, source: p.source, error: message(err) })
      return null
    }
  })

  /**
   * D-284: the newest override replaces `kind` after `normalize()`, never touching the trace. Read
   * only for activities that produced an entry; a failed read fails that activity, not the run.
   */
  const entries: DrillEntry[] = []
  let kindOverridesApplied = 0
  for (const n of results) {
    if (n === null) continue
    const overrideKey = e.kindOverrides.get(n.activity.activityId)
    if (overrideKey === undefined) {
      entries.push({ ...n, activity: applyKindOverride(n.activity, null) })
      continue
    }
    try {
      const { body } = await readBytes(opts, overrideKey)
      const override = JSON.parse(body.toString("utf8")) as KindOverride
      entries.push({ ...n, activity: applyKindOverride(n.activity, { override, key: overrideKey }) })
      kindOverridesApplied++
    } catch (err) {
      fail({ key: overrideKey, source: n.activity.source.source, error: `kind override: ${message(err)}` })
    }
  }

  return {
    entries,
    // Settled in completion order; sorted so two runs over the same archive print the same summary.
    failures: failures.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    supersededObjects: e.payloads.length - winners.size,
    kindOverridesApplied,
  }
}

// ─── Step 3: sort ───────────────────────────────────────────────────────────

/**
 * Step 3. `startedAt` ascending, ties by `activityId` — `foldOrder`, the one I-14 comparator, so the
 * drill and the fold cannot come to disagree. Everything after this is single-threaded per user.
 */
export function sortForFold(entries: readonly DrillEntry[]): DrillEntry[] {
  const key = (e: DrillEntry) => ({ activityId: e.activity.activityId, startedAt: e.activity.startedAt, cells: [] })
  return [...entries].sort((a, b) => foldOrder(key(a), key(b)))
}

// ─── Preconditions and step 0 ───────────────────────────────────────────────

export interface Precondition {
  n: 1 | 2 | 3 | 4
  name: string
  ok: boolean
  detail: string
}

export interface PreconditionInputs {
  enumeration: Enumeration
  /** `--expect-objects`. When absent, precondition 1 checks only that there is something. */
  expectObjects?: number
  /** `git ls-files rules/` at the commit the drill runs from. */
  rulesFiles: readonly string[]
  registeredSources: readonly SourceId[]
  newestSnapshotKey: string | undefined
}

/** §8.3's four, in order. Pure; the caller refuses to go on if any is not `ok`. */
export function checkPreconditions(i: PreconditionInputs): Precondition[] {
  const count = i.enumeration.objectCount
  const p1ok = i.enumeration.payloads.length > 0 && (i.expectObjects === undefined || count === i.expectObjects)
  const rules = i.rulesFiles.filter((f) => /^rules\/xp-rules-v\d+\.yaml$/.test(f))
  const missing = i.enumeration.sourceIds.filter((s) => !i.registeredSources.includes(s))
  return [
    {
      n: 1,
      name: "raw/ object count",
      ok: p1ok,
      detail:
        i.enumeration.payloads.length === 0
          ? `no payload objects under raw/${i.enumeration.userId}/ (${count} objects in all)`
          : i.expectObjects === undefined
            ? `${count} objects; no --expect-objects given, so only non-zero was checked`
            : `${count} objects, expected ${i.expectObjects}`,
    },
    {
      n: 2,
      name: "rules/xp-rules-v*.yaml in git",
      ok: rules.length > 0,
      detail: rules.length > 0 ? rules.join(", ") : "no rules/xp-rules-v*.yaml is tracked at this commit",
    },
    {
      n: 3,
      name: "an adapter for every source in raw/",
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? `sources ${i.enumeration.sourceIds.join(", ")} all registered`
          : `no registered adapter for: ${missing.join(", ")}`,
    },
    {
      n: 4,
      name: "newest skill-state snapshot downloaded",
      ok: i.newestSnapshotKey !== undefined,
      detail: i.newestSnapshotKey ?? `no snapshot under ${snapshotPrefix(i.enumeration.userId)}`,
    },
  ]
}

/** The greatest key under `snapshots/skillstate/<uid>/` (D-259: `<takenAt>-<generation>.json`). */
export async function newestSnapshot(
  userId: string,
  deps: DrillS3Deps,
): Promise<{ key: string; body: Buffer } | undefined> {
  let newest: string | undefined
  for (const { key } of await listAll(snapshotPrefix(userId), deps)) {
    if (key.endsWith(".json") && (newest === undefined || key > newest)) newest = key
  }
  if (newest === undefined) return undefined
  const { body } = await readBytes(deps, newest)
  const parsed = JSON.parse(body.toString("utf8")) as { userId?: unknown; skills?: unknown }
  if (parsed.userId !== userId || !Array.isArray(parsed.skills)) {
    throw new Error(`${newest} is not a skill-state snapshot for ${userId}`)
  }
  return { key: newest, body }
}

/** Step 0's verification target. A user with no manifest has published nothing: generation 0. */
export async function readVerificationTarget(
  userId: string,
  deps: DrillS3Deps,
): Promise<{ generation: number; cellCount: number; manifestKey: string; present: boolean }> {
  const manifestKey = objectKeys.manifest(userId)
  try {
    const { body } = await readBytes(deps, manifestKey)
    const m = JSON.parse(body.toString("utf8")) as { generation?: unknown; cellCount?: unknown }
    if (typeof m.generation !== "number" || typeof m.cellCount !== "number") {
      throw new Error(`${manifestKey} has no numeric generation/cellCount`)
    }
    return { generation: m.generation, cellCount: m.cellCount, manifestKey, present: true }
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) {
      return { generation: 0, cellCount: 0, manifestKey, present: false }
    }
    throw err
  }
}

// ─── The run ────────────────────────────────────────────────────────────────

export type DrillPhase = "enumerate" | "normalize"

export interface DrillSummary {
  phase: DrillPhase
  userId: string
  bucket: string
  dryRun: boolean
  refused: boolean
  preconditions: Precondition[]
  step0: { generation: number; cellCount: number; manifestPresent: boolean; snapshotKey: string | null; snapshotPath: string | null } | null
  objectCount: number
  payloadCount: number
  kindOverrideObjectCount: number
  duplicatePointerCount: number
  unrecognisedKeys: Array<{ key: string; reason: string }>
  sourceIds: SourceId[]
  /** Below: `null` in the enumerate phase, which does not normalize. */
  activityCount: number | null
  supersededObjects: number | null
  kindOverridesApplied: number | null
  normalizeFailures: number | null
  failures: DrillFailure[] | null
  firstStartedAt: string | null
  lastStartedAt: string | null
  /** Step 3's order. What `0104`/`0105` compare between runs. */
  sortedActivityIds: string[] | null
}

export interface FrontHalf {
  summary: DrillSummary
  /** Step 3's output and `0103`'s input. Empty unless the phase normalized. */
  sorted: DrillEntry[]
  /** `activityId` → D-263 pointer key, for `0103`'s step 8 check 2. */
  duplicatePointers: Map<string, string>
  /**
   * `0103`. Precondition 4's snapshot, parsed: step 6's D-135 waterline (D-399). `null` until the
   * preconditions pass. The same bytes `saveSnapshot` wrote to disk, so the file IS the waterline.
   */
  snapshot: SkillStateSnapshot | null
}

export interface RunDrillOptions extends DrillS3Deps {
  phase: DrillPhase
  userId: string
  dryRun: boolean
  expectObjects?: number
  rulesFiles: readonly string[]
  registeredSources: readonly SourceId[]
  adapterFor: (source: SourceId) => SourceAdapter
  /** Precondition 4: where the newest snapshot's bytes go. Returns the local path. */
  saveSnapshot: (key: string, body: Buffer) => string
  concurrency?: number
  onFailure?: (failure: DrillFailure) => void
}

/**
 * Preconditions, step 0, step 1 — and, in the `normalize` phase, steps 2 and 3. No S3 or DynamoDB
 * write anywhere: the only things it produces are the summary and the local snapshot copy.
 */
export async function runDrillFrontHalf(o: RunDrillOptions): Promise<FrontHalf> {
  const enumeration = await enumerateRaw(o.userId, o)
  const snapshot = await newestSnapshot(o.userId, o)
  const preconditions = checkPreconditions({
    enumeration,
    expectObjects: o.expectObjects,
    rulesFiles: o.rulesFiles,
    registeredSources: o.registeredSources,
    newestSnapshotKey: snapshot?.key,
  })
  const refused = preconditions.some((p) => !p.ok)

  const summary: DrillSummary = {
    phase: o.phase,
    userId: o.userId,
    bucket: o.bucket,
    dryRun: o.dryRun,
    refused,
    preconditions,
    step0: null,
    objectCount: enumeration.objectCount,
    payloadCount: enumeration.payloads.length,
    kindOverrideObjectCount: enumeration.kindOverrideObjectCount,
    duplicatePointerCount: enumeration.duplicatePointers.size,
    unrecognisedKeys: enumeration.unrecognised,
    sourceIds: enumeration.sourceIds,
    activityCount: null,
    supersededObjects: null,
    kindOverridesApplied: null,
    normalizeFailures: null,
    failures: null,
    firstStartedAt: null,
    lastStartedAt: null,
    sortedActivityIds: null,
  }
  const result: FrontHalf = { summary, sorted: [], duplicatePointers: enumeration.duplicatePointers, snapshot: null }
  if (refused) return result

  const target = await readVerificationTarget(o.userId, o)
  summary.step0 = {
    generation: target.generation,
    cellCount: target.cellCount,
    manifestPresent: target.present,
    snapshotKey: snapshot!.key,
    snapshotPath: o.saveSnapshot(snapshot!.key, snapshot!.body),
  }
  result.snapshot = JSON.parse(snapshot!.body.toString("utf8")) as SkillStateSnapshot
  if (o.phase === "enumerate") return result

  const normalized = await normalizeAll(enumeration, o)
  const sorted = sortForFold(normalized.entries)
  summary.activityCount = sorted.length
  summary.supersededObjects = normalized.supersededObjects
  summary.kindOverridesApplied = normalized.kindOverridesApplied
  summary.normalizeFailures = normalized.failures.length
  summary.failures = normalized.failures
  summary.firstStartedAt = sorted[0]?.activity.startedAt ?? null
  summary.lastStartedAt = sorted.at(-1)?.activity.startedAt ?? null
  summary.sortedActivityIds = sorted.map((e) => e.activity.activityId)
  result.sorted = sorted
  return result
}
