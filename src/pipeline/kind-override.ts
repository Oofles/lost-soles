import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3"

import { isPreconditionFailed } from "@/src/pipeline/archive"
import type { Activity, ActivityKind, SourceId } from "@/src/domain/activity"
import type { RuleSkill } from "@/src/rules/schema"

/**
 * A KIND OVERRIDE — THE OPERATOR'S CORRECTION OF WHAT AN ACTIVITY WAS. Ticket `0243`, D-284.
 *
 * `Activity.kind` is derived by `normalize()` from the source's type string, and every path that
 * writes it re-derives it: a re-sync `Put`s the row unconditionally, a `reingest` re-normalizes the
 * archived bytes, and the rebuild drill (`02` §8.3) re-normalizes all of `raw/`. An override kept
 * only on the T3 row would be undone by the next of any of them. So it lives where those paths all
 * read: `raw/`, as an immutable fact, applied after `normalize()` by every one of them.
 *
 * ─── WHERE IT LIVES ─────────────────────────────────────────────────────────
 *
 * `raw/<uid>/<source>/<externalId>.kind-override/<id>.json` — a SIBLING of the activity's archive
 * prefix, never inside it, for `dedupe.ts`'s reason: `replay.ts` lists
 * `raw/<uid>/<source>/<externalId>/` and replays the newest object there as the run.
 *
 * A DIRECTORY OF OBJECTS rather than one object, because `raw/*` is immutable (I-3) and an override
 * can be changed. A later override is a new object; the newest wins. `id` is time-first, so "newest"
 * is the greatest key — decided by the key alone, not by `LastModified`, which two PUTs in the same
 * second would tie on.
 *
 * ─── WHAT IT DOES NOT TOUCH: THE TRACE (D-284 a) ────────────────────────────
 *
 * The sanitizer's outlier gate is per-kind (D-197) and runs INSIDE `normalize()`, against the
 * derived kind. The override is applied to the activity normalize returned and never to its input,
 * so the trace is the one the source's own label produced — on live data and in a rebuild alike.
 */

/** The fact, as stored. Everything a later reader needs to say "was X, set by Y at Z". */
export interface KindOverride {
  /** Time-first and unique: `<YYYYMMDDTHHmmssSSSZ>-<rand>`. The key's last segment, and the run key of its floors. */
  id: string
  activityId: string
  userId: string
  source: SourceId
  externalId: string
  /** What `normalize()` said when the override was set. */
  derivedKind: ActivityKind
  /** What the operator says. */
  kind: ActivityKind
  /** The Cognito `sub`, or an operator tool's name. Audit only. */
  setBy: string
  setAt: string
}

/** What the T3 row mirrors (D-284 "fast read"). `null` on a row nobody has corrected. */
export interface KindOverrideMirror {
  kind: ActivityKind
  derivedKind: ActivityKind
  setBy: string
  setAt: string
  /** The `raw/` object it came from, so the mirror can always be checked against the fact. */
  key: string
}

/** An `Activity` once the override, if any, is applied. `kind` is the EFFECTIVE kind. */
export type KindCorrected = Activity & {
  derivedKind: ActivityKind
  kindOverride: KindOverrideMirror | null
}

type ActivityAddress = { userId: string; source: SourceId; externalId: string }

export function kindOverridePrefix(input: ActivityAddress): string {
  return `raw/${input.userId}/${input.source}/${input.externalId}.kind-override/`
}

export function kindOverrideKey(input: ActivityAddress, id: string): string {
  return `${kindOverridePrefix(input)}${id}.json`
}

/** Time-first so lexical order is time order; the suffix separates two in one millisecond. */
export function newKindOverrideId(now: Date, rand: () => number = Math.random): string {
  const stamp = now.toISOString().replace(/[-:.]/g, "")
  const tail = Math.floor(rand() * 36 ** 6).toString(36).padStart(6, "0")
  return `${stamp}-${tail}`
}

/**
 * THE KINDS THE RULES KNOW: every kind an enabled activity row matches on. Read off the registry
 * rather than off `ActivityKind`, because a kind no row matches would score nothing — and accepting
 * it would let an override quietly zero a run while saying it had been corrected.
 */
export function knownKinds(registry: { skills: readonly RuleSkill[] }): ReadonlySet<string> {
  const out = new Set<string>()
  for (const s of registry.skills) {
    if (s.kind !== "activity" || !s.enabled) continue
    for (const k of s.match?.kinds ?? []) out.add(k)
  }
  return out
}

export class UnknownKindError extends Error {
  constructor(
    readonly kind: string,
    readonly known: readonly string[],
  ) {
    super(`"${kind}" is not a kind the rules know about. Known: ${known.join(", ")}. Nothing was written.`)
    this.name = "UnknownKindError"
  }
}

export function assertKnownKind(kind: string, registry: { skills: readonly RuleSkill[] }): asserts kind is ActivityKind {
  const known = knownKinds(registry)
  if (!known.has(kind)) throw new UnknownKindError(kind, [...known].sort())
}

export interface KindOverrideS3 {
  send(command: PutObjectCommand): Promise<unknown>
  send(command: ListObjectsV2Command): Promise<{
    Contents?: Array<{ Key?: string }>
    IsTruncated?: boolean
    NextContinuationToken?: string
  }>
  send(command: GetObjectCommand): Promise<{ Body?: { transformToString(): Promise<string> } }>
}

export interface KindOverrideDeps {
  s3: KindOverrideS3
  bucket: string
}

/**
 * Writes the fact. `IfNoneMatch: "*"` because `raw/*` never overwrites (I-3); the id is unique, so
 * a refusal means this exact object already landed — a retried call — and is success.
 */
export async function recordKindOverride(override: KindOverride, deps: KindOverrideDeps): Promise<string> {
  const key = kindOverrideKey(override, override.id)
  try {
    await deps.s3.send(
      new PutObjectCommand({
        Bucket: deps.bucket,
        Key: key,
        ContentType: "application/json",
        IfNoneMatch: "*",
        Body: JSON.stringify(override),
      }),
    )
  } catch (error) {
    if (!isPreconditionFailed(error)) throw error
  }
  return key
}

/** The newest override for this activity, with its key, or `null` when it was never corrected. */
export async function readKindOverride(
  input: ActivityAddress,
  deps: KindOverrideDeps,
): Promise<{ override: KindOverride; key: string } | null> {
  const prefix = kindOverridePrefix(input)
  let newest: string | undefined
  let token: string | undefined
  do {
    const page = await deps.s3.send(
      new ListObjectsV2Command({ Bucket: deps.bucket, Prefix: prefix, ContinuationToken: token }),
    )
    for (const o of page.Contents ?? []) {
      if (o.Key?.endsWith(".json") && (newest === undefined || o.Key > newest)) newest = o.Key
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  if (newest === undefined) return null

  const got = await deps.s3.send(new GetObjectCommand({ Bucket: deps.bucket, Key: newest }))
  if (!got.Body) throw new Error(`kind override ${newest} has no body`)
  return { override: JSON.parse(await got.Body.transformToString()) as KindOverride, key: newest }
}

/**
 * APPLIED AFTER `normalize()`, AND ONLY TO THE ACTIVITY. Pure. Ingest, `reingest` and the rebuild
 * drill all call this one function, so none of them can honour an override differently.
 *
 * `derivedKind` is always the kind `normalize()` just produced, not the one stored in the override:
 * if an adapter's mapping is ever fixed, the row says what the source's label means NOW, and the
 * override still wins.
 */
export function applyKindOverride(
  activity: Activity,
  found: { override: KindOverride; key: string } | null,
): KindCorrected {
  if (found === null) return { ...activity, derivedKind: activity.kind, kindOverride: null }
  const { override, key } = found
  return {
    ...activity,
    kind: override.kind,
    derivedKind: activity.kind,
    kindOverride: { kind: override.kind, derivedKind: activity.kind, setBy: override.setBy, setAt: override.setAt, key },
  }
}
