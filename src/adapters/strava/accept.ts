import { createHash } from "node:crypto"

import type { AckResult, InboundRequest, IngestJob } from "../types"
import { acceptHandshake, VERIFY_TOKEN_ENV } from "./handshake"
import { parseWithExactIds } from "./json-ids"
import { userIdForOwner } from "./owner-map"
import { STRAVA_SUBSCRIPTION_ID } from "./subscription"

/**
 * PHASE 1 — `accept()` for Strava's push subscription. Tickets 0091, 0093.
 *
 * Runs in the public webhook Lambda on Strava's 2-second deadline (`03-integrations.md` §2.3,
 * `08-security-privacy.md` §4.5). NO network call, NO token, NO S3, NO clock beyond `enqueuedAt`.
 * It reads the body, decides, and hands back at most one command; the Lambda writes the receipt
 * and the queue message.
 *
 * ─── WHAT IS HANDLED, AND WHAT IS LEFT ──────────────────────────────────────
 *
 * From a known athlete: an `activity` `create` becomes one `ingest` command; an `activity` `update`
 * becomes one `reingest` command wrapping an ordinary fetch job (0282); an `activity` `delete`
 * becomes one `retract` command (0282); and an `athlete` deauthorization becomes one `disconnect`
 * command (0093). Everything else is acknowledged with a 200 and dropped — Strava only cares that
 * it got a 200, and a 400 would be a free oracle (§4.4). The `GET` `hub.challenge` handshake is
 * 0092's, in `handshake.ts`.
 *
 * ─── THE FILTER CHAIN, CHEAPEST AND LEAST TRUSTING FIRST (0093, §4.1, §4.4) ──
 *
 *   1. `Content-Type` must be JSON.        (the 8 KB cap runs before this, in the Lambda)
 *   2. The body must parse, to a plain object.
 *   3. EXACTLY the documented fields, of the documented types — an unknown key is a reject, not a
 *      skip, because a payload of 10,000 keys is a parser-cost attack (§4.4 item 3).
 *   4. `subscription_id` must be ours (`subscription.ts`); `null` there drops everything.
 *   5. `object_type` must be `activity` or `athlete`.
 *   6. `owner_id` must be in the static owner map (0091, Q1=A).
 *
 * None of these VERIFIES the event, and nothing could: Strava signs nothing (§4.1). They make a
 * forgery cheap to discard; the architecture is what makes one worthless.
 *
 * ─── THE BODY IS A POINTER, NEVER DATA (§4.1) ───────────────────────────────
 *
 * Only `object_type`, `aspect_type`, `object_id`, `owner_id`, `subscription_id` and — for a
 * deauthorization alone — `updates.authorized` are read for meaning. `event_time` reaches exactly
 * one place, an `update`'s receipt key (0282, D-356), where it tells two edits of one activity
 * apart; it is NOT a start date (D-343: the job omits `startedAt` rather than invent one). The
 * `updates` keys of an activity event are type-checked and discarded — an update re-fetches the
 * whole activity rather than believe a title or a type from the payload.
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

/**
 * AN EDIT'S KEY — `sha256("strava:<owner>:<object>:update:<event_time>")`. Ticket 0282, D-356.
 *
 * `event_time` is in it so that two edits of one activity are two receipts, while Strava's own
 * redelivery of ONE edit (same `event_time`) is a `duplicate`. The cost, stated: `event_time` is
 * attacker-chosen, so a forger can mint as many keys as they like — each one buys a re-fetch of our
 * own activity with our own token (§4.1's "worthless"), and the per-user flood counter (D-349)
 * bounds how many an hour.
 *
 * Never the create key: a create key would collide with the sweep's and the edit would be dropped
 * as a `duplicate` of the original import.
 */
export function updateKeyFor(externalOwnerId: string, externalId: string, eventTime: number): string {
  return createHash("sha256")
    .update(`strava:${externalOwnerId}:${externalId}:update:${eventTime}`)
    .digest("hex")
}

/**
 * A DELETION'S KEY — `sha256("strava:<owner>:<object>:delete")`, no `event_time` (0282, operator
 * Q3): an activity is deleted once, so every redelivery of its deletion is one receipt.
 */
export function deleteKeyFor(externalOwnerId: string, externalId: string): string {
  return createHash("sha256")
    .update(`strava:${externalOwnerId}:${externalId}:delete`)
    .digest("hex")
}

/** The event's id fields, kept as exact wire digits — `object_id` is an int64. */
const EVENT_ID_KEYS: ReadonlySet<string> = new Set(["owner_id", "object_id", "subscription_id"])

/**
 * EVERY TOP-LEVEL FIELD STRAVA DOCUMENTS (`03-integrations.md` §2.3), and no other. An event with
 * a key outside this set is dropped — §4.4 item 3: reject unknown fields rather than ignore them.
 *
 * THE COST OF STRICTNESS, stated: if Strava ever adds a field, every event is dropped as
 * `unknown-fields` until this set learns it. That is loud (the decision is logged) and lossless
 * (the sweep, 0095, is the path of record), which is why strict is affordable here.
 */
const EVENT_KEYS: ReadonlySet<string> = new Set([
  "object_type",
  "object_id",
  "aspect_type",
  "updates",
  "owner_id",
  "subscription_id",
  "event_time",
])

/**
 * The `updates` keys Strava documents: `title`, `type`, `private` on an activity update, and
 * `authorized` on a deauthorization. Values are scalars. Anything else is an unknown field.
 */
const UPDATE_KEYS: ReadonlySet<string> = new Set(["title", "type", "private", "authorized"])

/** Values logged verbatim. Anything else is attacker-chosen text and is logged as `"other"`. */
const KNOWN_ASPECTS = new Set(["create", "update", "delete"])

export type WebhookDecision =
  | "method-not-allowed"
  | "not-json"
  | "unparseable"
  | "unknown-fields"
  | "no-subscription"
  | "wrong-subscription"
  | "ignored-object-type"
  | "ignored-aspect"
  | "ignored-athlete-event"
  | "malformed-ids"
  | "missing-event-time"
  | "unknown-owner"
  | "enqueue"
  | "reingest"
  | "retract"
  | "deauthorize"

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

const isScalar = (v: unknown) =>
  typeof v === "string" || typeof v === "boolean" || typeof v === "number"

/** `application/json`, any case, optionally with parameters (`; charset=utf-8`). */
function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false
  return value.split(";")[0].trim().toLowerCase() === "application/json"
}

/**
 * THE SHAPE CHECK: exactly the documented keys, each of its documented type. The ids are already
 * digit strings (`parseWithExactIds`); `isId` checks them later, where a failure logs as
 * `malformed-ids` rather than `unknown-fields`, because that is the more useful line.
 *
 * `updates` must be a flat object of documented keys with scalar values — a nested object there is
 * the same parser-cost shape as an unknown top-level key, one level down.
 */
function hasOnlyKnownFields(event: Record<string, unknown>): boolean {
  for (const key of Object.keys(event)) if (!EVENT_KEYS.has(key)) return false
  if (typeof event.object_type !== "string" || typeof event.aspect_type !== "string") return false
  if (event.event_time !== undefined && typeof event.event_time !== "number") return false
  if (event.updates !== undefined) {
    if (!isRecord(event.updates)) return false
    for (const [key, value] of Object.entries(event.updates)) {
      if (!UPDATE_KEYS.has(key) || !isScalar(value)) return false
    }
  }
  return true
}

export interface AcceptOptions {
  now?: () => Date
  /** Injected by tests. Production reads the committed `STRAVA_SUBSCRIPTION_ID`. */
  subscriptionId?: number | null
  /**
   * The verify token, as the webhook's lazy SSM getter (`AcceptContext`, ticket 0286). Called on a
   * GET only — never on a POST, which is why an event's cold start makes no SSM call. Absent (a
   * test, or a caller with no getter) the token is read from the environment, which in the deployed
   * function holds no such key, so that path fails closed there too.
   */
  webhookSecret?: () => Promise<string | undefined>
}

export async function acceptStravaEvent(
  req: InboundRequest,
  options: AcceptOptions = {},
): Promise<AckResult> {
  if (req.method === "GET") {
    // `?? ""` and not `undefined`: undefined would re-trigger `acceptHandshake`'s env default.
    // An empty token is "unconfigured", a fail-closed 400.
    const token = options.webhookSecret
      ? ((await options.webhookSecret()) ?? "")
      : process.env[VERIFY_TOKEN_ENV]
    return acceptHandshake(req, token)
  }
  const now = options.now ?? (() => new Date())
  const ourSubscription =
    options.subscriptionId === undefined ? STRAVA_SUBSCRIPTION_ID : options.subscriptionId

  if (req.method !== "POST") {
    logDecision("method-not-allowed", undefined)
    return { status: 405, commands: [] }
  }

  if (!isJsonContentType(req.headers["content-type"])) {
    logDecision("not-json", undefined)
    return DROP
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
  if (!hasOnlyKnownFields(event)) {
    logDecision("unknown-fields", undefined)
    return DROP
  }

  const aspect = event.aspect_type

  /**
   * `null`: the subscription does not exist yet, or its id is not committed yet. Every event is
   * dropped, under its own name, so the log says WHY nothing is arriving.
   */
  if (ourSubscription === null) {
    logDecision("no-subscription", aspect)
    return DROP
  }
  if (event.subscription_id !== String(ourSubscription)) {
    logDecision("wrong-subscription", aspect)
    return DROP
  }

  if (event.object_type === "athlete") return acceptAthleteEvent(event, aspect)
  if (event.object_type !== "activity") {
    logDecision("ignored-object-type", aspect)
    return DROP
  }
  if (aspect !== "create" && aspect !== "update" && aspect !== "delete") {
    logDecision("ignored-aspect", aspect)
    return DROP
  }

  const ownerId = event.owner_id
  const externalId = event.object_id
  if (!isId(ownerId) || !isId(externalId)) {
    logDecision("malformed-ids", aspect)
    return DROP
  }

  /**
   * `update` needs `event_time` for its key (D-356), so it is checked here, BEFORE the owner
   * lookup, with the other shape checks. A positive safe integer: Strava sends epoch seconds.
   */
  const eventTime = event.event_time
  if (aspect === "update" && !(typeof eventTime === "number" && Number.isSafeInteger(eventTime) && eventTime > 0)) {
    logDecision("missing-event-time", aspect)
    return DROP
  }

  const userId = userIdForOwner(ownerId)
  if (userId === undefined) {
    logDecision("unknown-owner", aspect)
    return DROP
  }

  /**
   * DELETE → `retract` (0282). Nothing to fetch here; the worker asks Strava whether the activity
   * is really gone before it tombstones anything (D-355), and a tombstone never removes a cell
   * or a ledger row (`02` §4.7).
   */
  if (aspect === "delete") {
    const ingestKey = deleteKeyFor(ownerId, externalId)
    logDecision("retract", aspect, ingestKey)
    return {
      status: 200,
      commands: [{ kind: "retract", source: "strava", userId, externalId, ingestKey }],
    }
  }

  /**
   * UPDATE → `reingest`, WRAPPING AN ORDINARY `command: "ingest"` JOB (0282, D-356). The command
   * says what happened at the source; the job says what the worker does about it, and that is the
   * normal fetch path — re-fetch, re-archive (content-addressed, so the original bytes stay), and
   * persist under D-278: the first version's XP and award stand. NOT `command: "reingest"`, which
   * is 0192's replay verb: it reads the ARCHIVE, would never see the edit, and re-claims a `DONE`
   * receipt, which nothing a stranger can send should be able to do.
   */
  if (aspect === "update") {
    const job: IngestJob = {
      ingestKey: updateKeyFor(ownerId, externalId, eventTime as number),
      userId,
      source: "strava",
      externalId,
      command: "ingest",
      meta: { aspectType: "update" },
      enqueuedAt: now().toISOString(),
    }
    logDecision("reingest", aspect, job.ingestKey)
    return { status: 200, commands: [{ kind: "reingest", job }] }
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

/**
 * DEAUTHORIZATION — the one meaningful `athlete` event (`03-integrations.md` §2.3): the athlete
 * revoked us at Strava. `aspect_type: "update"`, `updates` EXACTLY `{"authorized": "false"}`, and
 * `object_id` is the athlete, so it must equal `owner_id`. Anything else on an athlete is dropped.
 *
 * It becomes a `disconnect` command (§7.4's trigger). The command names the USER, never the
 * athlete: `userId` comes from the static map, so nothing the payload says reaches the command
 * except the fact that it was a deauthorization.
 */
function acceptAthleteEvent(event: Record<string, unknown>, aspect: unknown): AckResult {
  const updates = isRecord(event.updates) ? event.updates : {}
  const isDeauth =
    aspect === "update" && Object.keys(updates).length === 1 && updates.authorized === "false"
  if (!isDeauth) {
    logDecision("ignored-athlete-event", aspect)
    return DROP
  }

  const ownerId = event.owner_id
  if (!isId(ownerId) || event.object_id !== ownerId) {
    logDecision("malformed-ids", aspect)
    return DROP
  }

  const userId = userIdForOwner(ownerId)
  if (userId === undefined) {
    logDecision("unknown-owner", aspect)
    return DROP
  }

  logDecision("deauthorize", aspect)
  return { status: 200, commands: [{ kind: "disconnect", source: "strava", userId }] }
}
