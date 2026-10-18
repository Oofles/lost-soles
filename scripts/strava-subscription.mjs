#!/usr/bin/env node
// THE PUSH SUBSCRIPTION, AS AN OPERATOR SCRIPT. Ticket 0092, 03-integrations.md §2.3.
//
//   node scripts/strava-subscription.mjs inspect         list what Strava has (read-only)
//   node scripts/strava-subscription.mjs create          self-check the callback, then create
//   node scripts/strava-subscription.mjs delete <id>     remove the subscription
//   node scripts/strava-subscription.mjs rotate-token    new CSPRNG verify token into SSM
//
// AWS calls use the `devault` profile (CLAUDE.md); export AWS_PROFILE=devault if your shell
// does not already. Node 22, no TypeScript — the same rule as the check scripts.
//
// ─── WHY THIS IS A SCRIPT AND NOT A SCREEN ──────────────────────────────────
//
// It runs once, ever. Strava allows exactly ONE subscription per application and its
// `callback_url` is fixed at creation, so the callback is permanent infrastructure: re-pointing
// it means delete + recreate, and in between the 6-hourly sweep (0095) is the only way a run
// gets in. A button for that would be a button for an outage. `create` and `delete` therefore
// print the warning and want the operator to TYPE a confirmation before anything is sent.
//
// ─── WHAT IT READS, AND WHAT IT NEVER PRINTS ────────────────────────────────
//
//   - client id / secret and the verify token: SSM SecureStrings under the shared Amplify path
//     (the same one `lib/sources/oauth-credentials.ts` reads). Never printed — not on success,
//     not in an error. Requests that carry them in a query string are never echoed.
//   - the callback: the `IngestWebhookUrl` CloudFormation output of the `main` branch's stack
//     plus `api/webhooks/strava` (0091 Q2 = A). Not the app's custom domain.
//
// ─── THE SUBSCRIPTION ID ────────────────────────────────────────────────────
//
// `create` prints the id Strava returns. The webhook filters on it (0093) by reading
// `STRAVA_SUBSCRIPTION_ID` in `src/adapters/strava/subscription.ts` — a committed constant, by
// the operator's decision, so the public endpoint needs no extra read. Set it there and commit;
// this script does not edit source.

import { createHash, randomBytes } from "node:crypto"
import { createInterface } from "node:readline/promises"

/** The Amplify app id. `lib/sources/oauth-credentials.ts` states the same; a test pins the two. */
export const APP_ID = "d14fhvl4rp79nn"
export const PARAMETER_PREFIX = `/amplify/shared/${APP_ID}/`
export const PARAMS = {
  clientId: "STRAVA_CLIENT_ID",
  clientSecret: "STRAVA_CLIENT_SECRET",
  verifyToken: "STRAVA_WEBHOOK_VERIFY_TOKEN",
}
export const API = "https://www.strava.com/api/v3/push_subscriptions"
export const CALLBACK_PATH = "api/webhooks/strava"
export const SUBSCRIPTION_FILE = "src/adapters/strava/subscription.ts"

export const PERMANENCE_WARNING = [
  "",
  "  ┌─ READ THIS BEFORE YOU TYPE ANYTHING ──────────────────────────────────────┐",
  "  │ Strava allows ONE push subscription per application, and its callback_url │",
  "  │ is fixed when it is created. The callback is PERMANENT INFRASTRUCTURE:     │",
  "  │ changing it means delete + recreate, and until a new subscription exists   │",
  "  │ no webhook events arrive. The reconciliation sweep (every 6 h, 48 h        │",
  "  │ overlap; nightly 14 d) is then the ONLY ingestion path — runs still        │",
  "  │ arrive, hours late.                                                         │",
  "  └────────────────────────────────────────────────────────────────────────────┘",
  "",
].join("\n")

/** Exact digits from raw JSON: never trust a parsed number for an id. */
export function parseSubscriptions(raw) {
  const text = String(raw).trim()
  if (!text.startsWith("[")) throw new Error("unexpected inspect response (not a JSON array)")
  const parsed = JSON.parse(text)
  const ids = [...text.matchAll(/"id"\s*:\s*(\d+)/g)].map((m) => m[1])
  return parsed.map((s, i) => ({
    id: ids[i] ?? String(s.id),
    callbackUrl: s.callback_url,
    createdAt: s.created_at,
  }))
}

export function parseCreatedId(raw) {
  const m = /^\s*\{[^]*?"id"\s*:\s*(\d+)/.exec(String(raw))
  if (!m) throw new Error("create response carried no id")
  return m[1]
}

/** The same exact bytes `src/adapters/strava/handshake.ts` emits. */
export const expectedChallengeBody = (challenge) => '{"hub.challenge":"' + challenge + '"}'

const fingerprint = (v) => `length ${v.length}, sha256 ${createHash("sha256").update(v).digest("hex").slice(0, 12)}…`

async function credentials(io) {
  const [clientId, clientSecret] = await Promise.all([
    io.ssmGet(PARAMETER_PREFIX + PARAMS.clientId),
    io.ssmGet(PARAMETER_PREFIX + PARAMS.clientSecret),
  ])
  return { clientId, clientSecret }
}

async function listSubscriptions(io, creds) {
  const q = new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret })
  const res = await io.fetch(`${API}?${q}`, { method: "GET" })
  const body = await res.text()
  if (!res.ok) throw new Error(`inspect failed: HTTP ${res.status} ${body.slice(0, 300)}`)
  return parseSubscriptions(body)
}

async function confirm(io, word) {
  const answer = (await io.prompt(`Type ${JSON.stringify(word)} to proceed, anything else to abort: `)).trim()
  if (answer !== word) {
    io.out("Aborted. Nothing was sent to Strava.")
    return false
  }
  return true
}

function report(io, subs, callback) {
  io.out(`${subs.length} subscription(s) on this application.`)
  for (const s of subs) {
    const mark = callback && s.callbackUrl === callback ? "  ← the production callback" : ""
    io.out(`  id ${s.id}  callback ${s.callbackUrl}  created ${s.createdAt}${mark}`)
  }
}

/**
 * THE SELF-CHECK, before Strava is ever asked. The handshake is the wrong place to discover a
 * serializer's opinion about dots in key names (the ticket's Notes): this sends our own GET to
 * the deployed callback with the real token and a fresh challenge, and requires the exact bytes.
 */
export async function selfCheck(io, callback, verifyToken) {
  const challenge = randomBytes(16).toString("hex")
  const q = new URLSearchParams({ "hub.mode": "subscribe", "hub.challenge": challenge, "hub.verify_token": verifyToken })
  const res = await io.fetch(`${callback}?${q}`, { method: "GET" })
  const body = await res.text()
  const type = res.headers.get("content-type") ?? ""
  const want = expectedChallengeBody(challenge)
  if (res.status !== 200 || !type.startsWith("application/json") || body !== want) {
    io.err(`Self-check FAILED: HTTP ${res.status}, content-type ${JSON.stringify(type)}, body ${JSON.stringify(body.slice(0, 200))}`)
    io.err(`  expected HTTP 200, application/json, body ${JSON.stringify(expectedChallengeBody("<challenge>"))}`)
    return false
  }
  io.out(`Self-check passed: the callback answered the exact bytes ${JSON.stringify(expectedChallengeBody("…"))}.`)
  return true
}

async function inspect(io) {
  const callback = await io.callbackUrl()
  const subs = await listSubscriptions(io, await credentials(io))
  io.out(`Production callback: ${callback}`)
  report(io, subs, callback)
  if (subs.length === 0) io.out("None yet. `create` makes the one subscription.")
  if (subs.length === 1 && subs[0].callbackUrl !== callback) {
    io.out("WARNING: the one subscription does NOT point at the production callback.")
  }
  return 0
}

async function create(io) {
  const callback = await io.callbackUrl()
  const creds = await credentials(io)
  const existing = await listSubscriptions(io, creds)
  if (existing.length > 0) {
    report(io, existing, callback)
    io.err("A subscription already exists; Strava allows one. `delete <id>` it first if it must change.")
    return 1
  }
  const verifyToken = await io.ssmGet(PARAMETER_PREFIX + PARAMS.verifyToken)
  if (!(await selfCheck(io, callback, verifyToken))) {
    io.err("Not creating: Strava's handshake would fail the same way. Nothing was sent to Strava.")
    return 1
  }

  io.out(PERMANENCE_WARNING)
  io.out(`About to CREATE the push subscription with callback_url:\n  ${callback}`)
  if (!(await confirm(io, "create"))) return 1

  const form = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    callback_url: callback,
    verify_token: verifyToken,
  })
  const res = await io.fetch(API, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  })
  const body = await res.text()
  if (!res.ok) {
    io.err(`Create failed: HTTP ${res.status} ${body.slice(0, 500)}`)
    io.err("Check the ingest-webhook log group for the handshake GET; run `inspect` before retrying.")
    return 1
  }
  const id = parseCreatedId(body)
  io.out(`Created. Subscription id: ${id}`)
  io.out(`NEXT: set STRAVA_SUBSCRIPTION_ID = ${id} in ${SUBSCRIPTION_FILE} and commit it —`)
  io.out("the webhook drops events whose subscription_id does not match (ticket 0093).")
  return 0
}

async function remove(io, id) {
  if (!/^\d{1,20}$/.test(id ?? "")) {
    io.err("usage: delete <subscription id>   (run `inspect` to see it)")
    return 2
  }
  const callback = await io.callbackUrl()
  const creds = await credentials(io)
  const existing = await listSubscriptions(io, creds)
  report(io, existing, callback)
  if (!existing.some((s) => s.id === id)) {
    io.err(`No subscription ${id} on this application. Nothing was sent.`)
    return 1
  }
  io.out(PERMANENCE_WARNING)
  io.out(`About to DELETE subscription ${id}. Webhook events stop until a new one is created.`)
  if (!(await confirm(io, id))) return 1

  const q = new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret })
  const res = await io.fetch(`${API}/${id}?${q}`, { method: "DELETE" })
  if (res.status !== 204 && !res.ok) {
    io.err(`Delete failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`)
    return 1
  }
  io.out(`Deleted subscription ${id}.`)
  io.out(`NEXT: set STRAVA_SUBSCRIPTION_ID back to null in ${SUBSCRIPTION_FILE} (or to the new id after \`create\`) and commit.`)
  return 0
}

/**
 * A NEW VERIFY TOKEN, from the CSPRNG, straight into SSM as a SecureString — never on screen,
 * never in a file, never in a shell history. 32 random bytes as hex: 64 characters of
 * `[0-9a-f]`, so it survives a query string untouched. Only its length and a hash prefix are
 * printed, which is enough to compare against the deployed function without revealing it.
 *
 * The token matters only at `create` (and any re-validation Strava does). Rotating it while a
 * subscription exists does not stop event delivery. The function picks it up on its next cold
 * start, and a warm one within about a minute (Amplify re-resolves `secret()` every 60 s).
 */
async function rotateToken(io) {
  io.out(`About to OVERWRITE ${PARAMETER_PREFIX}${PARAMS.verifyToken} with a new random token.`)
  io.out("Run this before `create`, never between the self-check and the create.")
  if (!(await confirm(io, "rotate"))) return 1
  const token = io.randomToken()
  await io.ssmPut(PARAMETER_PREFIX + PARAMS.verifyToken, token)
  io.out(`Stored as a SecureString (${fingerprint(token)}). The value was not printed.`)
  return 0
}

export async function run(argv, io) {
  const [command, arg] = argv
  switch (command) {
    case "inspect":
      return inspect(io)
    case "create":
      return create(io)
    case "delete":
      return remove(io, arg)
    case "rotate-token":
      return rotateToken(io)
    default:
      io.err("usage: node scripts/strava-subscription.mjs inspect | create | delete <id> | rotate-token")
      return 2
  }
}

// ─── THE REAL WIRING ─────────────────────────────────────────────────────────

/** The `main` branch's Function URL, from its CloudFormation output — never a sandbox's. */
export async function productionCallbackUrl(cfn, DescribeStacksCommand) {
  const urls = new Set()
  let NextToken
  do {
    const page = await cfn.send(new DescribeStacksCommand({ NextToken }))
    for (const stack of page.Stacks ?? []) {
      if (!stack.StackName?.startsWith(`amplify-${APP_ID}-main-`)) continue
      for (const o of stack.Outputs ?? []) {
        if (o.OutputKey?.startsWith("IngestWebhookUrl") && o.OutputValue) urls.add(o.OutputValue)
      }
    }
    NextToken = page.NextToken
  } while (NextToken)
  if (urls.size !== 1) throw new Error(`expected one IngestWebhookUrl output on the main branch, found ${urls.size}`)
  const base = [...urls][0]
  return (base.endsWith("/") ? base : base + "/") + CALLBACK_PATH
}

async function main() {
  const { SSMClient, GetParameterCommand, PutParameterCommand } = await import("@aws-sdk/client-ssm")
  const { CloudFormationClient, DescribeStacksCommand } = await import("@aws-sdk/client-cloudformation")
  const region = process.env.AWS_REGION ?? "us-east-1"
  const ssm = new SSMClient({ region })
  const cfn = new CloudFormationClient({ region })
  let cachedCallback
  const io = {
    fetch: (url, init) => fetch(url, init),
    async ssmGet(name) {
      const res = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }))
      const v = res.Parameter?.Value
      if (!v) throw new Error(`SSM parameter ${name} is missing or empty`)
      return v
    },
    async ssmPut(name, value) {
      await ssm.send(new PutParameterCommand({ Name: name, Value: value, Type: "SecureString", Overwrite: true }))
    },
    async callbackUrl() {
      cachedCallback ??= await productionCallbackUrl(cfn, DescribeStacksCommand)
      return cachedCallback
    },
    async prompt(question) {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      try {
        return await rl.question(question)
      } finally {
        rl.close()
      }
    },
    randomToken: () => randomBytes(32).toString("hex"),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  }
  process.exitCode = await run(process.argv.slice(2), io)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    // The message only: an SDK error can carry a request, and a request can carry a secret.
    console.error(`error: ${e?.name ?? "Error"}: ${String(e?.message ?? e).slice(0, 300)}`)
    process.exitCode = 1
  })
}
