import { createHash } from "node:crypto"

import type { AckResult, InboundRequest, IngestJob } from "../types"
import { parseWithExactIds } from "./json-ids"
import { userIdForOwner } from "./owner-map"

/**
 * PHASE 1 — `accept()` for Strava's push subscription. Ticket 0091.
 *
 * Runs in the public webhook Lambda on Strava's 2-second deadline (`03-integrations.md` §2.3,
 * `08-security-privacy.md` §4.5). NO network call, NO token, NO S3, NO clock beyond `enqueuedAt`.
 * It reads the body, decides, and hands back at most one command; the Lambda writes the receipt
 * and the queue message.
 *
 * ─── WHAT THIS TICKET HANDLES, AND WHAT IT LEAVES ───────────────────────────
 *
 * An `activity` `create` from a known athlete becomes one `ingest` command. Everything else is
 * acknowledged with a 200 and dropped — Strava only cares that it got a 200, and a 400 would be a
 * free oracle (§4.4). Left to later tickets, deliberately:
 *   - the `GET` `hub.challenge` handshake → 0092 (405 here until then);
 *   - `subscription_id` matching, unknown-field rejection, the size cap, deauthorization → 0093;
 *   - `update` / `delete` aspects → dropped; the sweep covers neither today either.
 *
 * ─── THE BODY IS A POINTER, NEVER DATA (§4.1) ───────────────────────────────
 *
 * Only `object_type`, `aspect_type`, `object_id` and `owner_id` are read. `event_time` is NOT a
 * start date (D-343: the job omits `startedAt` rather than invent one), and nothing else in a
 * payload reaches a job.
 */

/**
 * `sha256("<source>:<owner>:<object>:<aspect>")` — `01-architecture.md` §3 step 3, the formula the
 * webhook path uses. Defined here, beside the webhook, and re-exported from `adapter.ts` for the
 * sweep.
 *
 * THE COLLISION IS THE POINT, and it looks like a bug until you see it. A sweep that finds
 * activity 42 and a webhook `create` for activity 42 produce the SAME `ingestKey`, so the
 * conditional `PutItem` on `IngestReceipt` accepts whichever arrives first and silently
 * drops the second. That is the entire reason the sweep can run every six hours over a
 * 48-hour window without ingesting everything eight times.
 *
 * It is also why `aspectType` is `"create"` here rather than something honest-looking like
 * `"sweep"`: a distinct aspect would mint a distinct key, and the sweep would duplicate
 * every activity the webhook already delivered.
 */
export function ingestKeyFor(externalOwnerId: string, externalId: string): string {
  return createHash("sha256")
    .update(`strava:${externalOwnerId}:${externalId}:create`)
    .digest("hex")
}

/** The event's id fields, kept as exact wire digits — `object_id` is an int64. */
const EVENT_ID_KEYS: ReadonlySet<string> = new Set(["owner_id", "object_id", "subscription_id"])

/** Values logged verbatim. Anything else is attacker-chosen text and is logged as `"other"`. */
const KNOWN_ASPECTS = new Set(["create", "update", "delete"])

export type WebhookDecision =
  | "method-not-allowed"
  | "unparseable"
  | "ignored-object-type"
  | "ignored-aspect"
  | "malformed-ids"
  | "unknown-owner"
  | "enqueue"

/**
 * THE ONE LOG LINE, and what is missing from it is the point (§4.5, criterion 9): no body, no
 * `owner_id`, no coordinate — the payload has none, but a body logged "for debugging" is how the
 * first one would arrive. `ingestKey` is a hash, and `aspect_type` is one of three words.
 */
function logDecision(decision: WebhookDecision, aspect: unknown, ingestKey?: string): void {
  console.info(
    JSON.stringify({
      msg: "webhook-event",
      source: "strava",
      decision,
      aspect_type: typeof aspect === "string" && KNOWN_ASPECTS.has(aspect) ? aspect : "other",
      ...(ingestKey ? { ingestKey } : {}),
    }),
  )
}

const DROP: AckResult = { status: 200, commands: [] }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,20}$/.test(v)

export async function acceptStravaEvent(
  req: InboundRequest,
  now: () => Date = () => new Date(),
): Promise<AckResult> {
  if (req.method !== "POST") {
    logDecision("method-not-allowed", undefined)
    return { status: 405, commands: [] }
  }

  let event: unknown
  try {
    event = parseWithExactIds(req.rawBody.toString("utf8"), EVENT_ID_KEYS)
  } catch {
    logDecision("unparseable", undefined)
    return DROP
  }
  if (!isRecord(event)) {
    logDecision("unparseable", undefined)
    return DROP
  }

  const aspect = event.aspect_type
  if (event.object_type !== "activity") {
    logDecision("ignored-object-type", aspect)
    return DROP
  }
  if (aspect !== "create") {
    logDecision("ignored-aspect", aspect)
    return DROP
  }

  const ownerId = event.owner_id
  const externalId = event.object_id
  if (!isId(ownerId) || !isId(externalId)) {
    logDecision("malformed-ids", aspect)
    return DROP
  }

  const userId = userIdForOwner(ownerId)
  if (userId === undefined) {
    logDecision("unknown-owner", aspect)
    return DROP
  }

  const job: IngestJob = {
    ingestKey: ingestKeyFor(ownerId, externalId),
    userId,
    source: "strava",
    externalId,
    command: "ingest",
    /**
     * NO `startedAt` (D-343). The event does not carry the activity's start, and nothing that
     * could supply it may be called from here. Only the sweep reads the field, and the sweep's
     * jobs are `SweepJob`s, which always have it.
     *
     * NO `hasGpsHint` either, for the same reason: absent means "not known", and `fetchRaw`
     * decides from the activity detail it fetches anyway (D-344).
     */
    meta: { aspectType: "create" },
    enqueuedAt: now().toISOString(),
  }
  logDecision("enqueue", aspect, job.ingestKey)
  return { status: 200, commands: [{ kind: "ingest", job }] }
}
