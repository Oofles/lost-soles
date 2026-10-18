import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb"
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs"
import type { LambdaFunctionURLEvent } from "aws-lambda"

import { AUTHENTICATED_SUB_HEADER } from "@/src/adapters/principal"
import { getWebhookAdapter } from "@/src/adapters/registry"
import type { InboundRequest, IngestCommand } from "@/src/adapters/types"
import { computeActivityId } from "@/src/domain/activity-id"
import { disconnectMessage } from "@/src/pipeline/disconnect-message"
import { retractMessage } from "@/src/pipeline/retract-message"
import { acceptIngest, INGEST_RECEIPT_TABLE, type ReceiptDdb } from "@/src/pipeline/ingest-receipt"

import { countOwnerEvent } from "./owner-rate"

/**
 * THE WEBHOOK, AS A TRANSPORT. Ticket 0091.
 *
 * Exactly three steps (`03-integrations.md` §2.3): hand the bytes to the source's `accept()`,
 * put the receipt and send the message for each job it returns, answer. Everything the source
 * knows — what an event looks like, whose it is, which ones matter — is in the adapter. This
 * file knows a URL, a receipt and a queue, and nothing else is reachable from it: its role holds
 * `PutItem` on `LostSolesIngestReceipt`, `UpdateItem` on that table's `rate#` keys only (the
 * flood counter, 0093), and `SendMessage` on the ingest queue, and no grant on
 * `LostSolesSourceAccount`, so the public endpoint cannot read a token by policy (§4.5).
 *
 * ─── WHAT 0093 ADDED, ALL SOURCE-AGNOSTIC TRANSPORT ─────────────────────────
 *
 * A method allowlist (GET, POST; else 405), an 8 KB body cap checked before anything is decoded,
 * and a per-user flood counter in front of the receipt gate (`owner-rate.ts`). What an event must
 * look like — content type, exact field set, subscription id — is the adapter's (`accept()`).
 *
 * ─── THE ACCEPT GATE IS THE SAME ONE THE SYNC BUTTON USES ───────────────────
 *
 * `acceptIngest`, keyed on the adapter's `ingestKey` — and for a `create` that key is the one the
 * sweep mints for the same activity. Whichever of the two arrives first wins; the other is a
 * `duplicate` and sends nothing.
 *
 * ─── THE HOLE BETWEEN THE TWO WRITES, AND WHO FILLS IT ──────────────────────
 *
 * Accept-then-send is two operations. If the send fails, this answers 500 and Strava retries —
 * but the retry meets an existing receipt and is a `duplicate`. That activity is then held by a
 * `QUEUED`, `attempts: 0` receipt with no message, which is precisely the case `lib/sources/
 * sync.ts`'s `needsEnqueue` re-enqueues on the next sweep. It is not re-checked here because that
 * needs `GetItem`, a third grant the ticket's least-privilege criterion refuses; the sweep is the
 * path of record and this is a latency optimisation (§2.3).
 */

/** `/api/webhooks/<source>`, the fixed callback path. A source id is lower-case and short. */
const CALLBACK_PATH = /^\/api\/webhooks\/([a-z0-9-]{1,32})\/?$/

/**
 * METHOD ALLOWLIST (ticket 0093, `08-security-privacy.md` §4.4 item 4). GET for the handshake,
 * POST for events; anything else is a 405 with no body, decided before any adapter code runs.
 */
const ALLOWED_METHODS: ReadonlySet<string> = new Set(["GET", "POST"])

/**
 * THE HARD PAYLOAD CAP (ticket 0093, §4.4 item 2). Strava's events are a few hundred bytes; 8 KB
 * is twenty times that. Checked on the declared `Content-Length` AND on the bytes actually
 * received, BEFORE the body is decoded or parsed — the point is that an oversized body costs one
 * comparison. Answered with a 200 and no body, like every other rejected POST: a 413 tells a
 * prober where the limit is, and Strava does not care which success it gets.
 */
export const MAX_BODY_BYTES = 8 * 1024

function bodyTooLarge(event: LambdaFunctionURLEvent): boolean {
  const declared = Object.entries(event.headers ?? {}).find(
    ([k]) => k.toLowerCase() === "content-length",
  )?.[1]
  if (declared !== undefined && !(Number(declared) <= MAX_BODY_BYTES)) return true
  const body = event.body ?? ""
  // Base64 is 4 characters per 3 bytes, so the decoded size is bounded without decoding anything.
  const received = event.isBase64Encoded
    ? Math.floor((body.length * 3) / 4)
    : Buffer.byteLength(body, "utf8")
  return received > MAX_BODY_BYTES
}

export interface WebhookDeps {
  receipt: { ddb: ReceiptDdb; now?: () => Date }
  send(messageBody: string): Promise<void>
}

/**
 * ─── THE COLD START, AND WHY THE CLIENTS ARE BUILT AT IMPORT (ticket 0091 follow-up) ──
 *
 * At ~1 event/day every real event is a cold start, so the cold path IS the p99. Measured on the
 * deployed function before this change (Amplify job 408):
 *
 *   Init ≈ 290–310 ms, then Duration ≈ 180 ms with no AWS call at all (client construction), and
 *   ≈ 1,000–1,100 ms when the first DynamoDB call ran — 1.56–1.59 s client-side, against a 2 s
 *   deadline. The first SQS call was never measured live (every test event was a duplicate), and
 *   would have added several hundred more on a real `create`.
 *
 * The cause is CPU, not network. At 128 MB the invocation gets ~7 % of a vCPU, and an SDK v3
 * client's first request — endpoint-ruleset evaluation, middleware stack, signer, the TLS
 * handshake — is ~20 ms of CPU locally, i.e. hundreds of ms when throttled 14×. INIT IS NOT
 * THROTTLED THE SAME WAY: the 700 KB bundle imports in ~800 ms locally under a 7 % quota, yet
 * Lambda reports Init ≈ 300 ms for it. So the work moves into init:
 *
 *   1. Both clients are constructed at module scope.
 *   2. `warmUp` sends one request through each, during init, so the first real request finds a
 *      resolved endpoint, a built middleware stack and an open keep-alive socket.
 *
 * Reproduced locally with the same cgroup trick (init unthrottled, invoke at CPUQuota=7 %): the
 * invoke went from ~570 ms to ~87 ms, of which ~80 ms is home→us-east-1 round trips.
 *
 * ONLY INSIDE LAMBDA (`AWS_LAMBDA_FUNCTION_NAME`): a test that imports this file constructs no
 * client and makes no call.
 */
interface LiveClients {
  ddb: { send(command: PutCommand): Promise<unknown> }
  sqs: { send(command: SendMessageCommand): Promise<unknown> }
}

function buildLive(): { deps: WebhookDeps; clients: LiveClients } {
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  })
  const sqs = new SQSClient({})
  const queueUrl = process.env.INGEST_QUEUE_URL
  return {
    clients: { ddb, sqs },
    deps: {
      receipt: { ddb: ddb as unknown as ReceiptDdb },
      async send(messageBody) {
        if (!queueUrl) throw new Error("INGEST_QUEUE_URL is not set")
        await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: messageBody }))
      },
    },
  }
}

/**
 * ONE REQUEST THROUGH EACH CLIENT, AND NEITHER CAN HAVE AN EFFECT — using only the two grants the
 * function already holds (criterion 7 is unchanged):
 *
 *   - `PutItem` on a key no one can ever create, CONDITIONAL ON IT ALREADY EXISTING. A key that
 *     does not exist fails the condition, so this put never writes — and since it never writes,
 *     the key never comes to exist. Expected result: `ConditionalCheckFailedException`.
 *   - `SendMessage` with an EMPTY body. SQS requires at least one character, so the request is
 *     refused server-side and nothing is enqueued. Expected result: `InvalidParameterValue`
 *     (or `MissingParameter`). Should SQS ever accept it, the log line says so loudly, and the
 *     worker would reject an empty body into the DLQ, where the alarm fires — noise, never data.
 *
 * Bounded: init never waits more than `timeoutMs` for it, and nothing it does can throw. A cold
 * start that cannot warm up is merely as slow as before.
 */
export const WARMUP_KEY = "warmup#never-exists"

export async function warmUp(clients: LiveClients, queueUrl: string | undefined, timeoutMs = 1000): Promise<void> {
  const started = Date.now()
  const outcome = (p: Promise<unknown>, unexpected: string) =>
    p.then(
      () => unexpected,
      (e: unknown) => (e as { name?: string })?.name ?? "Error",
    )
  const work = Promise.all([
    outcome(
      clients.ddb.send(
        new PutCommand({
          TableName: INGEST_RECEIPT_TABLE,
          Item: { ingestKey: WARMUP_KEY },
          ConditionExpression: "attribute_exists(ingestKey)",
        }),
      ),
      "WROTE-UNEXPECTEDLY",
    ),
    queueUrl
      ? outcome(clients.sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: "" })), "SENT-UNEXPECTEDLY")
      : Promise.resolve("no-queue-url"),
  ])
  const timeout = new Promise<["timeout", "timeout"]>((resolve) =>
    setTimeout(() => resolve(["timeout", "timeout"]), timeoutMs).unref(),
  )
  const [ddb, sqs] = await Promise.race([work, timeout])
  console.info(JSON.stringify({ msg: "webhook-warmup", ms: Date.now() - started, ddb, sqs }))
}

const IN_LAMBDA = process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined
const live = IN_LAMBDA ? buildLive() : undefined
if (live) await warmUp(live.clients, process.env.INGEST_QUEUE_URL)

function defaultDeps(): WebhookDeps {
  return (live ?? buildLive()).deps
}

/** One generic line per request. Never a body, never a header value, never the path itself. */
function log(fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ msg: "webhook-ack", ...fields }))
}

/** The structured form of a Function URL result — never the bare-string shorthand, which means 200. */
export interface WebhookResponse {
  statusCode: number
  headers?: Record<string, string>
  body: string
}

const empty = (statusCode: number): WebhookResponse => ({ statusCode, body: "" })

function toInboundRequest(source: string, event: LambdaFunctionURLEvent): InboundRequest {
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(event.headers ?? {})) {
    if (v !== undefined) headers[k.toLowerCase()] = v
  }
  /**
   * NEVER FROM THE INTERNET. The principal header is how a trusted in-account caller names its
   * user to the `manual` adapter (`../principal.ts`). That adapter is not on the webhook
   * allowlist, so this is belt to that brace — but a header a stranger can set must not survive
   * into any adapter that might one day read it.
   */
  delete headers[AUTHENTICATED_SUB_HEADER]
  const query: Record<string, string> = {}
  for (const [k, v] of Object.entries(event.queryStringParameters ?? {})) {
    if (v !== undefined) query[k] = v
  }
  return {
    source: source as InboundRequest["source"],
    method: event.requestContext.http.method,
    headers,
    query,
    rawBody: Buffer.from(event.body ?? "", event.isBase64Encoded ? "base64" : "utf8"),
  }
}

/**
 * THE FLOOD LINE (ticket 0093). Its own `msg`, because a metric filter on exactly this term drives
 * the alarm (`amplify/backend.ts`). No user id: the count says what happened.
 */
function logFlood(source: string, count: number): void {
  console.info(JSON.stringify({ msg: "webhook-flood", source, count }))
}

/**
 * A DEAUTHORIZATION (0093, D-348): this function cannot touch `SourceAccount`, so it forwards the
 * claim to the worker as a `DisconnectMessage`, which confirms it with the provider before acting.
 * No receipt — a disconnect has no activity — but two counters: the athlete's general budget, and
 * a far tighter deauth budget, because each one costs the worker a provider call.
 */
async function forwardDisconnect(
  source: string,
  command: Extract<IngestCommand, { kind: "disconnect" }>,
  deps: WebhookDeps,
): Promise<string> {
  for (const bucket of ["events", "deauth"] as const) {
    const rate = await countOwnerEvent({ source, userId: command.userId, bucket }, deps.receipt)
    if (!rate.withinBudget) {
      logFlood(source, rate.count)
      return bucket === "events" ? "owner-flood" : "deauth-flood"
    }
  }
  const now = deps.receipt.now?.() ?? new Date()
  await deps.send(JSON.stringify(disconnectMessage({ source: command.source, userId: command.userId, now })))
  return "disconnect-queued"
}

/**
 * A DELETION (0282, D-NEW-a). The `DisconnectMessage` shape again: this function can neither ask
 * the provider nor touch the activity table, so it forwards the claim as a `RetractMessage` and the
 * worker confirms it before it tombstones anything. Unlike a disconnect it HAS an activity, so it
 * passes the same receipt gate as a job — Strava's redeliveries of one deletion are one receipt —
 * behind two counters: the athlete's general budget (D-349) and a tight delete budget, because
 * each one costs the worker a provider call.
 */
async function forwardRetract(
  source: string,
  command: Extract<IngestCommand, { kind: "retract" }>,
  deps: WebhookDeps,
): Promise<string> {
  for (const bucket of ["events", "delete"] as const) {
    const rate = await countOwnerEvent({ source, userId: command.userId, bucket }, deps.receipt)
    if (!rate.withinBudget) {
      logFlood(source, rate.count)
      return bucket === "events" ? "owner-flood" : "delete-flood"
    }
  }
  const accepted = await acceptIngest(
    {
      ingestKey: command.ingestKey,
      userId: command.userId,
      activityId: computeActivityId(command.userId, command.source, command.externalId),
      source: command.source,
    },
    deps.receipt,
  )
  if (accepted.kind === "duplicate") return "duplicate"
  const now = deps.receipt.now?.() ?? new Date()
  await deps.send(
    JSON.stringify(
      retractMessage({
        source: command.source,
        userId: command.userId,
        externalId: command.externalId,
        ingestKey: command.ingestKey,
        now,
      }),
    ),
  )
  return "retract-queued"
}

async function enqueue(source: string, command: IngestCommand, deps: WebhookDeps): Promise<string> {
  if (command.kind === "disconnect") return forwardDisconnect(source, command, deps)
  if (command.kind === "retract") return forwardRetract(source, command, deps)
  /**
   * `ingest` and `reingest` take the same path: a `reingest` from a source edit (0282) wraps an
   * ordinary fetch job under its own key, so nothing here needs to tell them apart.
   */
  const { job } = command

  /**
   * THE PER-ATHLETE COUNTER RUNS FIRST (0093, §4.4 item 6), so a flood of one event is dropped
   * here rather than also costing a receipt write. Only events that passed every cheap filter in
   * `accept()` reach it.
   */
  const rate = await countOwnerEvent({ source, userId: job.userId }, deps.receipt)
  if (!rate.withinBudget) {
    logFlood(source, rate.count)
    return "owner-flood"
  }
  const accepted = await acceptIngest(
    {
      ingestKey: job.ingestKey,
      userId: job.userId,
      activityId: computeActivityId(job.userId, job.source, job.externalId),
      source: job.source,
    },
    deps.receipt,
  )
  if (accepted.kind === "duplicate") return "duplicate"
  await deps.send(JSON.stringify(job))
  return "queued"
}

export async function handleWebhook(
  event: LambdaFunctionURLEvent,
  deps: WebhookDeps = defaultDeps(),
): Promise<WebhookResponse> {
  const match = CALLBACK_PATH.exec(event.rawPath ?? "")
  const adapter = match ? getWebhookAdapter(match[1]) : undefined
  if (!match || !adapter) {
    log({ decision: "unknown-path" })
    return empty(404)
  }
  const source = match[1]

  const method = event.requestContext.http.method
  if (!ALLOWED_METHODS.has(method)) {
    log({ source, decision: "method-not-allowed" })
    return empty(405)
  }
  if (method === "POST" && bodyTooLarge(event)) {
    log({ source, decision: "oversize" })
    return empty(200)
  }

  try {
    const ack = await adapter.accept(toInboundRequest(source, event))
    const outcomes: Array<{ ingestKey?: string; outcome: string }> = []
    for (const command of ack.commands) {
      const outcome = await enqueue(source, command, deps)
      outcomes.push({
        ...("job" in command
          ? { ingestKey: command.job.ingestKey }
          : "ingestKey" in command
            ? { ingestKey: command.ingestKey }
            : {}),
        outcome,
      })
    }
    log({ source, status: ack.status, outcomes })
    if (ack.body === undefined) return empty(ack.status)
    return {
      statusCode: ack.status,
      headers: { "content-type": "application/json" },
      // A string is emitted VERBATIM — 0092's `{"hub.challenge": X}` must be exact bytes.
      body: typeof ack.body === "string" ? ack.body : JSON.stringify(ack.body),
    }
  } catch (error) {
    // The class only: a message can quote a request, and a request is not for CloudWatch.
    log({ source, status: 500, errorClass: (error as Error)?.name ?? "Error" })
    return empty(500)
  }
}

export const handler = (event: LambdaFunctionURLEvent): Promise<WebhookResponse> =>
  handleWebhook(event)
