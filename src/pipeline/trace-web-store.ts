import { gunzipSync, gzipSync } from "node:zlib"

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"

import { simplifyLine } from "@/src/domain/simplify-line"

import { backoffDelayMs, isManifestRaceLost } from "./explored-blob-store"
import type { RouteTraceGeometry } from "./route-trace-store"

/**
 * THE PERMANENT RECORD OF EVERY ROUTE, AS ONE OBJECT. Ticket `0085`, D-299.
 * `06-ui-ux.md` §3.5 rule 2: *"every route you have ever run … it costs one GeoJSON source"*.
 *
 * One object per user, holding every traced activity's geometry keyed by its id. The map fetches it
 * once (`GET /api/runs/web`) and `lib/trace-web/web.ts` turns it into the drawn web. The per-run
 * objects `route-trace-store.ts` writes stay the source of truth; this is DERIVED from them and
 * `tools/trace-web/rebuild-trace-web.ts` rebuilds it from them, so losing it costs a rebuild.
 *
 * ─── WHY THE INPUTS ARE STORED AND NOT THE DRAWN WEB ────────────────────────
 *
 * Beat 1 on a run with no new ground shows *"this line joining the web"*, which needs the web as it
 * was WITHOUT this run as well as with it. Storing the inputs makes "without" a filter on the client;
 * storing the drawn web would need a second object per run, or a server-side build per request.
 *
 * ─── NOTHING READS THIS FOR SCORING ─────────────────────────────────────────
 *
 * §3.5: *"nothing is scored off it, there is no '10th time' badge (N4)"*. This module is written by
 * the ingest worker after the score is computed from cells, and it is imported by no scoring module —
 * `trace-web-store.test.ts` greps for that, so a future import is a failing test, not a review comment.
 */

/** `users/<uid>/traces/web.json.gz`. Beside the per-run objects, under the worker's existing grant. */
export const traceWebKey = (userId: string): string => `users/${userId}/traces/web.json.gz`

/** GeoJSON order, `[lng, lat]`. */
type Position = [number, number]

export interface TraceWebRun {
  /** `activity.startedAt`, ISO. Orders the build so the web does not depend on ingest order. */
  startedAt: string
  /** The route's lines, simplified (`simplifyLine`). Gaps stay gaps: one entry per line. */
  lines: Position[][]
}

export interface TraceWeb {
  v: 1
  runs: Record<string, TraceWebRun>
}

export const EMPTY_TRACE_WEB: TraceWeb = { v: 1, runs: {} }

/**
 * FIVE DECIMAL PLACES, ~1.1 m — one fewer than the per-run object's six. The web is drawn, never
 * measured, and at 2 m simplification the sixth place is noise that costs a byte per ordinate.
 */
const round5 = (n: number): number => Math.round(n * 1e5) / 1e5

export function webRunFrom(startedAt: string, geometry: RouteTraceGeometry): TraceWebRun {
  return {
    startedAt,
    lines: geometry.coordinates
      .map((l) => simplifyLine(l).map(([lng, lat]): Position => [round5(lng), round5(lat)]))
      .filter((l) => l.length >= 2),
  }
}

export function parseTraceWeb(bytes: Uint8Array, key: string): TraceWeb {
  const parsed = JSON.parse(gunzipSync(bytes).toString("utf8")) as Partial<TraceWeb>
  if (parsed.v !== 1 || typeof parsed.runs !== "object" || parsed.runs === null) {
    throw new Error(`${key}: not a v1 trace web`)
  }
  return { v: 1, runs: parsed.runs }
}

export const encodeTraceWeb = (web: TraceWeb): Buffer => gzipSync(Buffer.from(JSON.stringify(web), "utf8"))

export interface TraceWebS3 {
  send(command: GetObjectCommand): Promise<{ Body?: { transformToByteArray(): Promise<Uint8Array> }; ETag?: string }>
  send(command: PutObjectCommand): Promise<{ ETag?: string }>
}

export interface TraceWebDeps {
  s3: TraceWebS3
  bucket: string
  /** Re-reads before giving up on a lost race. The worker runs five at once (D-266). */
  maxAttempts?: number
  /** Injected so a test does not sleep. */
  backoff?: (attempt: number) => Promise<void>
}

const isNoSuchKey = (e: unknown): boolean => {
  const x = e as { name?: string; $metadata?: { httpStatusCode?: number } } | undefined
  return x?.name === "NoSuchKey" || x?.name === "NotFound" || x?.$metadata?.httpStatusCode === 404
}

export async function readTraceWeb(
  userId: string,
  deps: Pick<TraceWebDeps, "s3" | "bucket">,
): Promise<{ web: TraceWeb; etag?: string } | undefined> {
  const key = traceWebKey(userId)
  try {
    const out = await deps.s3.send(new GetObjectCommand({ Bucket: deps.bucket, Key: key }))
    const bytes = await out.Body?.transformToByteArray()
    if (bytes === undefined) throw new Error(`${key} returned no body`)
    return { web: parseTraceWeb(bytes, key), etag: out.ETag }
  } catch (e) {
    if (isNoSuchKey(e)) return undefined
    throw e
  }
}

/**
 * Apply `edit` to the stored web and write it back, serialised by `IfMatch` exactly as the explored
 * manifest is (D-219): a 412 means another worker wrote first, and the edit is redone on what it wrote.
 * The edit is keyed by activity id, so a redelivery or a re-ingest replaces its own entry — idempotent.
 */
export async function editTraceWeb(
  userId: string,
  edit: (web: TraceWeb) => TraceWeb,
  deps: TraceWebDeps,
): Promise<void> {
  const maxAttempts = deps.maxAttempts ?? 10
  const backoff =
    deps.backoff ?? ((attempt: number) => new Promise<void>((r) => setTimeout(r, backoffDelayMs(attempt))))
  for (let attempt = 0; ; attempt++) {
    const prior = await readTraceWeb(userId, deps)
    const next = edit(prior?.web ?? { v: 1, runs: {} })
    try {
      await deps.s3.send(
        new PutObjectCommand({
          Bucket: deps.bucket,
          Key: traceWebKey(userId),
          Body: encodeTraceWeb(next),
          ContentType: "application/json",
          ContentEncoding: "gzip",
          CacheControl: "no-cache",
          ...(prior?.etag !== undefined ? { IfMatch: prior.etag } : { IfNoneMatch: "*" }),
        }),
      )
      return
    } catch (e) {
      if (!isManifestRaceLost(e)) throw e
      if (attempt + 1 >= maxAttempts) {
        throw new Error(`editTraceWeb: lost the race on attempt ${attempt + 1} for ${userId}`, { cause: e })
      }
      await backoff(attempt)
    }
  }
}

/**
 * Put one activity's route into the web. Called by the ingest worker's `traces` phase, after the
 * per-run object is written, so a failure leaves the receipt `PROCESSING` and redelivery repeats it.
 */
export async function upsertTraceWeb(
  input: { userId: string; activityId: string; startedAt: string; geometry: RouteTraceGeometry },
  deps: TraceWebDeps,
): Promise<void> {
  const run = webRunFrom(input.startedAt, input.geometry)
  if (run.lines.length === 0) return
  await editTraceWeb(
    input.userId,
    (web) => ({ v: 1, runs: { ...web.runs, [input.activityId]: run } }),
    deps,
  )
}
