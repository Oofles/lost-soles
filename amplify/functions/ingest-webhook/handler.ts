import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs"
import type { LambdaFunctionURLEvent } from "aws-lambda"

import { AUTHENTICATED_SUB_HEADER } from "@/src/adapters/principal"
import { getWebhookAdapter } from "@/src/adapters/registry"
import type { InboundRequest, IngestCommand } from "@/src/adapters/types"
import { computeActivityId } from "@/src/domain/activity-id"
import { acceptIngest, type ReceiptDdb } from "@/src/pipeline/ingest-receipt"

/**
 * THE WEBHOOK, AS A TRANSPORT. Ticket 0091.
 *
 * Exactly three steps (`03-integrations.md` §2.3): hand the bytes to the source's `accept()`,
 * put the receipt and send the message for each job it returns, answer. Everything the source
 * knows — what an event looks like, whose it is, which ones matter — is in the adapter. This
 * file knows a URL, a receipt and a queue, and nothing else is reachable from it: its role holds
 * `PutItem` on `LostSolesIngestReceipt` and `SendMessage` on the ingest queue, and no grant on
 * `LostSolesSourceAccount`, so the public endpoint cannot read a token by policy (§4.5).
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

export interface WebhookDeps {
  receipt: { ddb: ReceiptDdb; now?: () => Date }
  send(messageBody: string): Promise<void>
}

let liveDeps: WebhookDeps | undefined

/** Built on first use, not at import: a test of the routing never constructs an AWS client. */
function defaultDeps(): WebhookDeps {
  if (liveDeps) return liveDeps
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  }) as unknown as ReceiptDdb
  const sqs = new SQSClient({})
  const queueUrl = process.env.INGEST_QUEUE_URL
  liveDeps = {
    receipt: { ddb },
    async send(messageBody) {
      if (!queueUrl) throw new Error("INGEST_QUEUE_URL is not set")
      await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: messageBody }))
    },
  }
  return liveDeps
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

async function enqueue(command: IngestCommand, deps: WebhookDeps): Promise<string> {
  if (command.kind !== "ingest" && command.kind !== "reingest") return "unhandled-command"
  const { job } = command
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

  try {
    const ack = await adapter.accept(toInboundRequest(source, event))
    const outcomes: Array<{ ingestKey?: string; outcome: string }> = []
    for (const command of ack.commands) {
      const outcome = await enqueue(command, deps)
      outcomes.push({
        ...("job" in command ? { ingestKey: command.job.ingestKey } : {}),
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
