import { createHash } from "node:crypto"
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import { build } from "esbuild"
import type { LambdaFunctionURLEvent } from "aws-lambda"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SourceId } from "@/src/domain/activity"
import { computeActivityId } from "@/src/domain/activity-id"
import { INGEST_RECEIPT_TABLE } from "@/src/pipeline/ingest-receipt"

import { handleWebhook, warmUp, WARMUP_KEY, type WebhookDeps } from "./handler"

/**
 * Ticket 0091 — the webhook as a transport, end to end through the REAL adapter (`registry.ts` →
 * `accept.ts`), with the two AWS calls captured. Criteria 2, 6, 8 and 9.
 *
 * The athlete id below is the one `src/adapters/strava/owner-map.ts` maps; it is an identifier,
 * not a credential, and the map is the thing under test.
 */
const KNOWN_OWNER = "51449053"
const OWNER_SUB = "5488e4b8-d081-7014-748e-edd1937f8083"
const PATH = "/api/webhooks/strava"
/** The source the path names, read back from the path so no vendor literal sits in `amplify/` (D-100). */
const SOURCE = PATH.split("/").pop() as SourceId

function event(over: Partial<{ method: string; path: string; body: unknown; base64: boolean; headers: Record<string, string> }> = {}): LambdaFunctionURLEvent {
  const raw = typeof over.body === "string" ? over.body : JSON.stringify(over.body ?? createEvent())
  return {
    rawPath: over.path ?? PATH,
    headers: { "content-type": "application/json", ...(over.headers ?? {}) },
    body: over.base64 ? Buffer.from(raw).toString("base64") : raw,
    isBase64Encoded: over.base64 ?? false,
    requestContext: { http: { method: over.method ?? "POST" } },
  } as unknown as LambdaFunctionURLEvent
}

/**
 * `object_id` past 2^53 ON PURPOSE, written as raw JSON digits: Strava activity ids are int64,
 * and an id that survived `JSON.parse` as a double would be a different activity.
 */
const BIG_ID = "17284759302841234567"
function createEvent(over: Record<string, unknown> = {}) {
  return { object_type: "activity", object_id: 1360128428, aspect_type: "create", updates: {}, owner_id: Number(KNOWN_OWNER), subscription_id: 120475, event_time: 1516126040, ...over }
}

function rig(opts: { duplicate?: boolean; sendFails?: boolean } = {}) {
  const puts: Array<Record<string, unknown>> = []
  const sent: string[] = []
  const deps: WebhookDeps = {
    receipt: {
      ddb: {
        async send(command) {
          puts.push((command as { input: Record<string, unknown> }).input)
          if (opts.duplicate) throw Object.assign(new Error("dup"), { name: "ConditionalCheckFailedException" })
          return {}
        },
      },
      now: () => new Date("2026-10-16T12:00:00Z"),
    },
    async send(body) {
      if (opts.sendFails) throw Object.assign(new Error("boom https://sqs/…"), { name: "QueueDoesNotExist" })
      sent.push(body)
    },
  }
  return { deps, puts, sent }
}

const logs: string[] = []
vi.spyOn(console, "info").mockImplementation((line: unknown) => {
  logs.push(String(line))
})
afterEach(() => {
  logs.length = 0
})

describe("a valid create event for a known athlete (criterion 8)", () => {
  it("puts one conditional receipt, sends exactly one message, and answers 200 with an empty body", async () => {
    const { deps, puts, sent } = rig()
    const res = await handleWebhook(event(), deps)

    expect(res).toEqual({ statusCode: 200, body: "" })
    expect(sent).toHaveLength(1)
    expect(puts).toHaveLength(1)
    expect(puts[0].TableName).toBe(INGEST_RECEIPT_TABLE)
    expect(puts[0].ConditionExpression).toBe("attribute_not_exists(ingestKey)")

    const job = JSON.parse(sent[0])
    expect(job).toMatchObject({ userId: OWNER_SUB, source: SOURCE, externalId: "1360128428", command: "ingest", meta: { aspectType: "create" } })
    // D-343: a push job does not invent a start date.
    expect(job).not.toHaveProperty("startedAt")
    // D-344: nor a GPS hint.
    expect(job.meta).not.toHaveProperty("hasGpsHint")
    expect((puts[0].Item as Record<string, unknown>).activityId).toBe(computeActivityId(OWNER_SUB, SOURCE, "1360128428"))
  })

  /**
   * THE SWEEP'S KEY, restated from the design's formula (`01-architecture.md` §3 step 3) rather
   * than imported: this file may not reach into an adapter's directory (D-121.1 — deleting it must
   * break only `registry.ts`). `adapter.test.ts` pins the sweep to the same formula.
   */
  it("mints the SAME ingestKey the sweep mints for that activity", async () => {
    const { deps, sent } = rig()
    await handleWebhook(event(), deps)
    const sweepKey = createHash("sha256").update(`strava:${KNOWN_OWNER}:1360128428:create`).digest("hex")
    expect(JSON.parse(sent[0]).ingestKey).toBe(sweepKey)
  })

  it("keeps an int64 object_id exact", async () => {
    const { deps, sent } = rig()
    const body = JSON.stringify(createEvent()).replace("1360128428", BIG_ID)
    await handleWebhook(event({ body }), deps)
    expect(JSON.parse(sent[0]).externalId).toBe(BIG_ID)
  })

  it("reads a base64-encoded body the same way", async () => {
    const { deps, sent } = rig()
    await handleWebhook(event({ base64: true }), deps)
    expect(sent).toHaveLength(1)
  })

  it("sends nothing on a duplicate receipt, and still answers 200", async () => {
    const { deps, sent } = rig({ duplicate: true })
    const res = await handleWebhook(event(), deps)
    expect(res.statusCode).toBe(200)
    expect(sent).toHaveLength(0)
  })

  it("answers 500 when the queue write fails, so Strava retries — and logs only the error class", async () => {
    const { deps } = rig({ sendFails: true })
    const res = await handleWebhook(event(), deps)
    expect(res).toEqual({ statusCode: 500, body: "" })
    expect(logs.join("\n")).toContain("QueueDoesNotExist")
    expect(logs.join("\n")).not.toContain("https://")
  })
})

describe("events that are acknowledged and dropped", () => {
  it.each([
    ["an unknown athlete", createEvent({ owner_id: 999 }), "unknown-owner"],
    ["an athlete event", createEvent({ object_type: "athlete", updates: { authorized: "false" } }), "ignored-object-type"],
    ["an update", createEvent({ aspect_type: "update", updates: { title: "x" } }), "ignored-aspect"],
    ["a delete", createEvent({ aspect_type: "delete" }), "ignored-aspect"],
    ["a non-numeric id", createEvent({ object_id: "abc" }), "malformed-ids"],
    ["an unparseable body", "{not json", "unparseable"],
    ["a JSON array", "[1,2]", "unparseable"],
  ])("%s → 200, empty body, no receipt, no message", async (_name, body, decision) => {
    const { deps, puts, sent } = rig()
    const res = await handleWebhook(event({ body: typeof body === "string" ? body : JSON.stringify(body) }), deps)
    expect(res).toEqual({ statusCode: 200, body: "" })
    expect(puts).toHaveLength(0)
    expect(sent).toHaveLength(0)
    expect(logs.join("\n")).toContain(`"decision":"${decision}"`)
  })
})

describe("routing", () => {
  it.each(["/", "/api/webhooks", "/api/webhooks/manual", "/api/webhooks/nosuch", "/api/webhooks/strava/extra", "/API/WEBHOOKS/STRAVA"])(
    "%s → 404 with no body, and nothing written",
    async (path) => {
      const { deps, puts, sent } = rig()
      expect(await handleWebhook(event({ path }), deps)).toEqual({ statusCode: 404, body: "" })
      expect(puts).toHaveLength(0)
      expect(sent).toHaveLength(0)
    },
  )

  it("refuses the manual adapter even with a forged principal header", async () => {
    const { deps, sent } = rig()
    const res = await handleWebhook(
      event({ path: "/api/webhooks/manual", headers: { "x-authenticated-sub": OWNER_SUB } }),
      deps,
    )
    expect(res.statusCode).toBe(404)
    expect(sent).toHaveLength(0)
  })

  it("answers a GET with 405 until 0092 builds the handshake", async () => {
    const { deps } = rig()
    expect((await handleWebhook(event({ method: "GET" }), deps)).statusCode).toBe(405)
  })
})

describe("the log line (criterion 9)", () => {
  it("names the ingestKey and aspect_type, and carries no body, no owner_id and no coordinate", async () => {
    const { deps, sent } = rig()
    const marker = createEvent({ updates: { title: "Morning Run 40.7128,-74.0060" } })
    await handleWebhook(event({ body: marker }), deps)
    const all = logs.join("\n")
    const key = JSON.parse(sent[0]).ingestKey as string

    expect(all).toContain(key)
    expect(all).toContain('"aspect_type":"create"')
    expect(all).not.toContain(KNOWN_OWNER)
    expect(all).not.toContain("owner_id")
    expect(all).not.toContain("Morning Run")
    expect(all).not.toMatch(/-?\d{1,3}\.\d{3,}/)
    expect(all).not.toContain("subscription_id")
  })

  it("logs an attacker-chosen aspect_type as 'other', never verbatim", async () => {
    const { deps } = rig()
    await handleWebhook(event({ body: createEvent({ aspect_type: "<script>" }) }), deps)
    expect(logs.join("\n")).toContain('"aspect_type":"other"')
    expect(logs.join("\n")).not.toContain("<script>")
  })
})

/**
 * Criterion 2. The webhook must never be served by the SSR bundle (§4.5): its cold start risks
 * the deadline and a UI deploy redeploys it. A file system walk, because a route handler IS a file.
 */
describe("no Next.js route handler serves the webhook path (criterion 2)", () => {
  function filesUnder(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const full = join(dir, n)
      return statSync(full).isDirectory() ? filesUnder(full) : [full]
    })
  }

  it("app/ has no route under api/webhooks, literal or dynamic", () => {
    const routes = filesUnder(join(process.cwd(), "app"))
      .map((f) => f.slice(process.cwd().length + 1))
      .filter((f) => /\/route\.(t|j)sx?$/.test(f))
    expect(routes.length).toBeGreaterThan(0) // the walk found the real routes
    expect(routes.filter((f) => /^app\/(\([^/]+\)\/)*api\/webhooks(\/|$)/.test(f))).toEqual([])
    // And no catch-all at app/api that could swallow it.
    expect(routes.filter((f) => /^app\/api\/\[\[?\.\.\./.test(f))).toEqual([])
  })
})

/**
 * Criterion 6. The bundle is built here with the flags Amplify's `defineFunction` uses (ESM,
 * minified, AWS SDK v3 bundled), so the ceiling is measured on what ships less Amplify's fixed
 * SSM-resolver banner. Almost all of it is SDK v3; the app code is ~15 KB. A jump past the
 * ceiling means something was imported that belongs in `process-activity`.
 */
describe("the bundle (criterion 6)", () => {
  const CEILING_BYTES = 700 * 1024

  it("is under the ceiling and contains no AWS SDK v2, no h3 and no ORM", async () => {
    const result = await build({
      entryPoints: [join(process.cwd(), "amplify/functions/ingest-webhook/handler.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      minify: true,
      write: false,
      metafile: true,
      logLevel: "silent",
    })
    const size = result.outputFiles[0].contents.byteLength
    expect(size).toBeLessThan(CEILING_BYTES)

    // What actually reached the output — a module tree-shaken to zero bytes is not shipped.
    const [output] = Object.values(result.metafile.outputs)
    const inputs = Object.entries(output.inputs)
      .filter(([, v]) => v.bytesInOutput > 0)
      .map(([k]) => k)
    const forbidden = /node_modules\/(aws-sdk|h3-js|prisma|@prisma|typeorm|sequelize|mongoose|drizzle-orm|zod)\//
    expect(inputs.filter((i) => forbidden.test(i))).toEqual([])
    // Nothing from the fog side rides along: those are the modules that pull in h3.
    expect(inputs.filter((i) => /src\/domain\/(fog|fold|discovery|frontier)\b/.test(i))).toEqual([])
  }, 60_000)
})

/**
 * The cold-start warm-up (ticket 0091 follow-up). It runs during init, inside Lambda only, and
 * its whole safety argument is that NEITHER request can have an effect. That argument is pinned
 * here as request shapes, because a "tidy-up" that dropped the condition or filled the body would
 * turn a warm-up into a write.
 */
describe("warmUp", () => {
  function clients(behaviour: { ddb?: () => Promise<unknown>; sqs?: () => Promise<unknown> } = {}) {
    const seen: { ddb: Array<Record<string, unknown>>; sqs: Array<Record<string, unknown>> } = { ddb: [], sqs: [] }
    const fail = (name: string) => () => Promise.reject(Object.assign(new Error(name), { name }))
    return {
      seen,
      clients: {
        ddb: { send: (c: { input: unknown }) => (seen.ddb.push(c.input as Record<string, unknown>), (behaviour.ddb ?? fail("ConditionalCheckFailedException"))()) },
        sqs: { send: (c: { input: unknown }) => (seen.sqs.push(c.input as Record<string, unknown>), (behaviour.sqs ?? fail("InvalidParameterValue"))()) },
      } as never,
    }
  }

  it("puts only on a key that cannot exist, conditional on it existing — so it never writes", async () => {
    const { seen, clients: c } = clients()
    await warmUp(c, "https://sqs.example/q")
    expect(seen.ddb).toEqual([
      { TableName: INGEST_RECEIPT_TABLE, Item: { ingestKey: WARMUP_KEY }, ConditionExpression: "attribute_exists(ingestKey)" },
    ])
  })

  it("sends only an EMPTY body, which SQS refuses — so it never enqueues", async () => {
    const { seen, clients: c } = clients()
    await warmUp(c, "https://sqs.example/q")
    expect(seen.sqs).toEqual([{ QueueUrl: "https://sqs.example/q", MessageBody: "" }])
  })

  it("logs the expected refusals, and says so loudly if either request unexpectedly succeeded", async () => {
    await warmUp(clients().clients, "q")
    expect(logs.join("\n")).toMatch(/"ddb":"ConditionalCheckFailedException","sqs":"InvalidParameterValue"/)
    logs.length = 0
    await warmUp(clients({ ddb: async () => ({}), sqs: async () => ({}) }).clients, "q")
    expect(logs.join("\n")).toMatch(/WROTE-UNEXPECTEDLY.*SENT-UNEXPECTEDLY/)
  })

  it("never throws and never holds init past its bound", async () => {
    const hang = () => new Promise(() => {})
    const t = Date.now()
    await expect(warmUp(clients({ ddb: hang, sqs: hang }).clients, "q", 50)).resolves.toBeUndefined()
    expect(Date.now() - t).toBeLessThan(1000)
    expect(logs.join("\n")).toContain('"ddb":"timeout"')
  })

  it("is not run outside Lambda: importing the handler in a test made no call", () => {
    expect(process.env.AWS_LAMBDA_FUNCTION_NAME).toBeUndefined()
    expect(logs.join("\n")).not.toContain("webhook-warmup")
  })
})
