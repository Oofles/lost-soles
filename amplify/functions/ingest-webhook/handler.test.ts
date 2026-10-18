import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { build } from "esbuild"
import type { LambdaFunctionURLEvent } from "aws-lambda"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SourceId } from "@/src/domain/activity"
import { computeActivityId } from "@/src/domain/activity-id"
import { INGEST_RECEIPT_TABLE } from "@/src/pipeline/ingest-receipt"

import { handleWebhook, MAX_BODY_BYTES, warmUp, WARMUP_KEY, type WebhookDeps } from "./handler"

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

/**
 * The subscription id is a committed constant (`subscription.ts`), `null` until 0092 creates the
 * subscription — and `null` drops every event. These tests drive the path an event takes once the
 * id is committed, so the constant is replaced with the id the fixtures carry. The adapter's own
 * tests (`accept.test.ts`) cover the `null` and mismatch cases.
 */
vi.mock("@/src/adapters/strava/subscription", () => ({ STRAVA_SUBSCRIPTION_ID: 120475 }))

/**
 * A stateful fake of the receipt table: `PutItem` with `attribute_not_exists` behaves like the
 * real conditional write (so a replay is a real duplicate), and `UpdateItem` `ADD` counts.
 */
function rig(opts: { duplicate?: boolean; sendFails?: boolean; startCount?: number } = {}) {
  const puts: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  const sent: string[] = []
  const keys = new Set<string>()
  const counts = new Map<string, number>()
  const deps: WebhookDeps = {
    receipt: {
      ddb: {
        async send(command) {
          const input = (command as { input: Record<string, unknown> }).input
          if ("UpdateExpression" in input) {
            updates.push(input)
            const key = (input.Key as { ingestKey: string }).ingestKey
            const next = (counts.get(key) ?? opts.startCount ?? 0) + 1
            counts.set(key, next)
            return { Attributes: { eventCount: next } }
          }
          puts.push(input)
          const key = (input.Item as { ingestKey: string }).ingestKey
          if (opts.duplicate || keys.has(key)) {
            throw Object.assign(new Error("dup"), { name: "ConditionalCheckFailedException" })
          }
          keys.add(key)
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
  return { deps, puts, updates, sent }
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
    ["a club event", createEvent({ object_type: "club" }), "ignored-object-type"],
    ["an athlete update that is not a deauthorization", createEvent({ object_type: "athlete", object_id: Number(KNOWN_OWNER), aspect_type: "update", updates: { title: "x" } }), "ignored-athlete-event"],
    ["another subscription's event", createEvent({ subscription_id: 1 }), "wrong-subscription"],
    ["an unknown top-level field", createEvent({ extra: 1 }), "unknown-fields"],
    ["an unknown updates field", createEvent({ updates: { lat: 40.1 } }), "unknown-fields"],
    ["an unknown aspect", createEvent({ aspect_type: "archive" }), "ignored-aspect"],
    ["an update with no event_time", createEvent({ aspect_type: "update", event_time: undefined }), "missing-event-time"],
    ["a non-numeric id", createEvent({ object_id: "abc" }), "malformed-ids"],
    ["an unparseable body", "{not json", "unparseable"],
    ["a JSON array", "[1,2]", "unparseable"],
  ])("%s → 200, empty body, no receipt, no counter, no message", async (_name, body, decision) => {
    const { deps, puts, updates, sent } = rig()
    const res = await handleWebhook(event({ body: typeof body === "string" ? body : JSON.stringify(body) }), deps)
    expect(res).toEqual({ statusCode: 200, body: "" })
    expect(puts).toHaveLength(0)
    expect(updates).toHaveLength(0)
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

  it("answers a method that is neither POST nor the GET handshake with 405", async () => {
    const { deps } = rig()
    expect((await handleWebhook(event({ method: "PUT" }), deps)).statusCode).toBe(405)
  })
})

/*
 * ─── TICKET 0093 — validation, replay, cost-DoS ──────────────────────────────
 */

describe("replay (0093 criterion 4)", () => {
  it("the same event three times: three 200s, ONE message, and the 2nd and 3rd cost one conditional write each", async () => {
    const { deps, puts, sent } = rig()
    const responses = []
    for (let i = 0; i < 3; i++) responses.push(await handleWebhook(event(), deps))

    expect(responses).toEqual([0, 1, 2].map(() => ({ statusCode: 200, body: "" })))
    expect(sent).toHaveLength(1)
    expect(puts).toHaveLength(3)
    for (const put of puts) expect(put.ConditionExpression).toBe("attribute_not_exists(ingestKey)")
    expect(new Set(puts.map((p) => (p.Item as { ingestKey: string }).ingestKey)).size).toBe(1)
  })
})

describe("the method allowlist (0093 criterion 10)", () => {
  it.each(["PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])("%s → 405 with no body, nothing read or written", async (method) => {
    const { deps, puts, updates, sent } = rig()
    expect(await handleWebhook(event({ method }), deps)).toEqual({ statusCode: 405, body: "" })
    expect(puts).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(sent).toHaveLength(0)
    // Decided before the adapter ran: the adapter's own log line never appears.
    expect(logs.join("\n")).not.toContain("webhook-event")
  })
})

describe("the 8 KB cap (0093 criterion 8)", () => {
  it("a declared Content-Length over 8 KB is dropped with a 200 BEFORE the body is parsed", async () => {
    const { deps, puts, sent } = rig()
    // A valid event: if anything parsed it, it would be enqueued.
    const res = await handleWebhook(event({ headers: { "content-length": String(MAX_BODY_BYTES + 1) } }), deps)
    expect(res).toEqual({ statusCode: 200, body: "" })
    expect(puts).toHaveLength(0)
    expect(sent).toHaveLength(0)
    expect(logs.join("\n")).toContain('"decision":"oversize"')
    expect(logs.join("\n")).not.toContain("webhook-event")
  })

  it("a 20 KB body is dropped even when Content-Length lies, plain or base64", async () => {
    for (const base64 of [false, true]) {
      const { deps, puts, sent } = rig()
      const body = JSON.stringify(createEvent()) + " ".repeat(20 * 1024)
      const res = await handleWebhook(event({ body, base64, headers: { "content-length": "200" } }), deps)
      expect(res).toEqual({ statusCode: 200, body: "" })
      expect(puts).toHaveLength(0)
      expect(sent).toHaveLength(0)
    }
    expect(logs.join("\n")).not.toContain("webhook-event")
  })

  it("a non-numeric Content-Length is treated as oversize, not as zero", async () => {
    const { deps, sent } = rig()
    await handleWebhook(event({ headers: { "content-length": "lots" } }), deps)
    expect(sent).toHaveLength(0)
  })

  it("an ordinary event is well inside the cap", async () => {
    const { deps, sent } = rig()
    await handleWebhook(event({ headers: { "content-length": String(JSON.stringify(createEvent()).length) } }), deps)
    expect(sent).toHaveLength(1)
  })
})

describe("non-JSON, unparseable and unknown-field bodies (0093 criterion 9)", () => {
  it.each([
    ["text/plain", { "content-type": "text/plain" }, JSON.stringify(createEvent()), "not-json"],
    ["no content-type", { "content-type": "" }, JSON.stringify(createEvent()), "not-json"],
    ["form-encoded", { "content-type": "application/x-www-form-urlencoded" }, "a=1", "not-json"],
    ["unparseable JSON", {}, '{"object_type":', "unparseable"],
    ["an extra field", {}, JSON.stringify(createEvent({ distance: 5000 })), "unknown-fields"],
    ["a nested updates value", {}, JSON.stringify(createEvent({ updates: { title: { a: 1 } } })), "unknown-fields"],
  ])("%s → 200, no body, no detail, nothing reaches SQS", async (_name, headers, body, decision) => {
    const { deps, puts, sent } = rig()
    const res = await handleWebhook(event({ headers, body }), deps)
    expect(res).toEqual({ statusCode: 200, body: "" })
    expect(puts).toHaveLength(0)
    expect(sent).toHaveLength(0)
    expect(logs.join("\n")).toContain(`"decision":"${decision}"`)
  })

  it("accepts JSON with a charset parameter", async () => {
    const { deps, sent } = rig()
    await handleWebhook(event({ headers: { "content-type": "application/json; charset=utf-8" } }), deps)
    expect(sent).toHaveLength(1)
  })
})

describe("the per-athlete flood counter (0093 criterion 11)", () => {
  it("counts each accepted-shape event in the receipt table, on a rate# key with a TTL", async () => {
    const { deps, updates } = rig()
    await handleWebhook(event(), deps)
    expect(updates).toHaveLength(1)
    const u = updates[0] as { TableName: string; Key: { ingestKey: string }; UpdateExpression: string }
    expect(u.TableName).toBe(INGEST_RECEIPT_TABLE)
    expect(u.Key.ingestKey).toBe(`rate#${SOURCE}#${OWNER_SUB}#2026-10-16T12`)
    expect(u.UpdateExpression).toContain("ADD")
    expect(u.UpdateExpression).toContain("ttl")
    // The athlete id is not in the key.
    expect(u.Key.ingestKey).not.toContain(KNOWN_OWNER)
  })

  it("the 51st event in an hour is dropped with a 200, costs no receipt write, and logs webhook-flood", async () => {
    const { deps, puts, sent } = rig()
    for (let i = 0; i < 50; i++) {
      await handleWebhook(event({ body: createEvent({ object_id: 1000 + i }) }), deps)
    }
    expect(sent).toHaveLength(50)
    expect(logs.join("\n")).not.toContain("webhook-flood")

    const res = await handleWebhook(event({ body: createEvent({ object_id: 9999 }) }), deps)
    expect(res).toEqual({ statusCode: 200, body: "" })
    expect(sent).toHaveLength(50)
    expect(puts).toHaveLength(50)
    expect(logs.join("\n")).toContain('"msg":"webhook-flood"')
    expect(logs.join("\n")).toContain('"outcome":"owner-flood"')
  })

  it("a flood of one duplicated event stops costing receipt writes past the threshold", async () => {
    const { deps, puts, sent } = rig({ startCount: 50 })
    for (let i = 0; i < 10; i++) await handleWebhook(event(), deps)
    expect(sent).toHaveLength(0)
    expect(puts).toHaveLength(0)
  })

  it("never counts what the cheap filters already dropped — a stranger's flood costs no write", async () => {
    const { deps, updates } = rig()
    for (let i = 0; i < 5; i++) await handleWebhook(event({ body: createEvent({ owner_id: 999 }) }), deps)
    expect(updates).toHaveLength(0)
  })
})

/**
 * 0093 criterion 15 — THE PAYLOAD IS A POINTER, NEVER DATA (§4.1), as a grep. A webhook event's
 * own field names are read in exactly one kind of file, an adapter's `accept.ts`, and nowhere
 * downstream: no worker, pipeline, domain, scoring or UI code reads `event_time`, `updates` or any
 * other field of an event. What leaves `accept()` is the job, whose keys the first describe block
 * pins (ids, `aspectType`, and the enqueue clock).
 */
describe("no webhook payload field is read outside accept() (0093 criterion 15)", () => {
  const FIELD = /\.(event_time|updates|subscription_id|owner_id|object_id|object_type|aspect_type)\b|\[["'](event_time|updates|subscription_id|owner_id|object_id|object_type|aspect_type)["']\]/

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      if (n === "node_modules" || n.startsWith(".")) return []
      const full = join(dir, n)
      return statSync(full).isDirectory() ? sourceFiles(full) : /\.(ts|tsx)$/.test(n) ? [full] : []
    })
  }

  it("every hit is in an adapter's accept.ts", () => {
    const root = process.cwd()
    const hits = ["src", "lib", "app", "components", "amplify"]
      .flatMap((d) => sourceFiles(join(root, d)))
      .filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes("__fixtures__"))
      .filter((f) => FIELD.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(root.length + 1))
    expect(hits.length).toBeGreaterThan(0) // the scan can see the one legitimate reader
    expect(hits.filter((f) => !/^src\/adapters\/[a-z0-9-]+\/accept\.ts$/.test(f))).toEqual([])
  })
})

describe("a deauthorization (0093 criterion 14, the webhook half)", () => {
  const deauth = () =>
    createEvent({ object_type: "athlete", object_id: Number(KNOWN_OWNER), aspect_type: "update", updates: { authorized: "false" } })

  it("sends ONE disconnect message naming the user, writes no receipt, and answers 200", async () => {
    const { deps, puts, updates, sent } = rig()
    const res = await handleWebhook(event({ body: deauth() }), deps)
    expect(res).toEqual({ statusCode: 200, body: "" })
    expect(puts).toHaveLength(0)
    expect(updates).toHaveLength(2) // the athlete's general budget, and the deauth budget
    expect(sent.map((s) => JSON.parse(s))).toEqual([
      { command: "disconnect", source: SOURCE, userId: OWNER_SUB, enqueuedAt: "2026-10-16T12:00:00.000Z" },
    ])
    expect(sent[0]).not.toContain(KNOWN_OWNER)
  })

  it("past four in an hour, a deauthorization is dropped: each costs the worker a provider call", async () => {
    const { deps, sent } = rig()
    for (let i = 0; i < 10; i++) await handleWebhook(event({ body: deauth() }), deps)
    expect(sent).toHaveLength(4)
    expect(logs.join("\n")).toContain('"outcome":"deauth-flood"')
    expect(logs.join("\n")).toContain('"msg":"webhook-flood"')
  })
})

/**
 * Ticket 0282 — an activity's `update` and `delete`, end to end through the real adapter. The keys
 * are restated from the formulas, for the reason the create-key test gives (D-121.1).
 */
describe("an activity update (0282, D-NEW-b)", () => {
  const update = (eventTime = 1760000000) =>
    createEvent({ aspect_type: "update", updates: { title: "x" }, event_time: eventTime })
  const updateKey = (eventTime = 1760000000) =>
    createHash("sha256").update(`strava:${KNOWN_OWNER}:1360128428:update:${eventTime}`).digest("hex")

  it("counts once, puts one receipt under the update key, and sends one ordinary ingest job", async () => {
    const { deps, puts, updates, sent } = rig()
    expect(await handleWebhook(event({ body: update() }), deps)).toEqual({ statusCode: 200, body: "" })
    expect(updates).toHaveLength(1) // D-349: the general budget, in front of the receipt gate
    expect(puts).toHaveLength(1)
    expect((puts[0].Item as Record<string, unknown>).ingestKey).toBe(updateKey())
    expect((puts[0].Item as Record<string, unknown>).activityId).toBe(computeActivityId(OWNER_SUB, SOURCE, "1360128428"))
    const job = JSON.parse(sent[0]!)
    expect(job).toMatchObject({ ingestKey: updateKey(), command: "ingest", meta: { aspectType: "update" } })
    // D-343's key set, unchanged: an update is an IngestJob like any other.
    expect(Object.keys(job).sort()).toEqual(["command", "enqueuedAt", "externalId", "ingestKey", "meta", "source", "userId"])
    expect(logs.join("\n")).toContain('"outcome":"queued"')
  })

  it("the source's redelivery of one edit is a duplicate; a second edit is not", async () => {
    const { deps, sent } = rig()
    await handleWebhook(event({ body: update() }), deps)
    await handleWebhook(event({ body: update() }), deps)
    await handleWebhook(event({ body: update(1760000600) }), deps)
    expect(sent.map((m) => JSON.parse(m).ingestKey)).toEqual([updateKey(), updateKey(1760000600)])
  })

  it("an update does not collide with the original create's receipt", async () => {
    const { deps, sent } = rig()
    await handleWebhook(event(), deps)
    await handleWebhook(event({ body: update() }), deps)
    expect(sent).toHaveLength(2)
  })
})

describe("an activity delete (0282, D-NEW-a)", () => {
  const del = () => createEvent({ aspect_type: "delete" })
  const deleteKey = createHash("sha256").update(`strava:${KNOWN_OWNER}:1360128428:delete`).digest("hex")

  it("counts twice, puts one receipt under the delete key, and sends ONE retract message", async () => {
    const { deps, puts, updates, sent } = rig()
    expect(await handleWebhook(event({ body: del() }), deps)).toEqual({ statusCode: 200, body: "" })
    expect(updates.map((u) => (u.Key as { ingestKey: string }).ingestKey)).toEqual([
      `rate#${SOURCE}#${OWNER_SUB}#2026-10-16T12`,
      `rate#${SOURCE}#${OWNER_SUB}#delete#2026-10-16T12`,
    ])
    expect(puts).toHaveLength(1)
    expect(puts[0].Item).toMatchObject({
      ingestKey: deleteKey,
      status: "QUEUED",
      userId: OWNER_SUB,
      activityId: computeActivityId(OWNER_SUB, SOURCE, "1360128428"),
    })
    expect(sent.map((m) => JSON.parse(m))).toEqual([
      {
        command: "retract",
        source: SOURCE,
        userId: OWNER_SUB,
        externalId: "1360128428",
        ingestKey: deleteKey,
        enqueuedAt: "2026-10-16T12:00:00.000Z",
      },
    ])
    expect(sent[0]).not.toContain(KNOWN_OWNER)
    expect(logs.join("\n")).toContain('"outcome":"retract-queued"')
    expect(logs.join("\n")).toContain(`"ingestKey":"${deleteKey}"`)
  })

  it("the source's retries of one deletion are one receipt and one message", async () => {
    const { deps, sent } = rig()
    for (let i = 0; i < 3; i++) await handleWebhook(event({ body: del() }), deps)
    expect(sent).toHaveLength(1)
    expect(logs.join("\n")).toContain('"outcome":"duplicate"')
  })

  it("past four in an hour, a delete is dropped before the receipt: each costs the worker a provider call", async () => {
    const { deps, puts, sent } = rig()
    for (let i = 0; i < 10; i++) await handleWebhook(event({ body: createEvent({ aspect_type: "delete", object_id: 2000 + i }) }), deps)
    expect(sent).toHaveLength(4)
    expect(puts).toHaveLength(4)
    expect(logs.join("\n")).toContain('"outcome":"delete-flood"')
  })

  it("the general budget still binds a delete (D-349)", async () => {
    const { deps, puts, sent } = rig({ startCount: 50 })
    await handleWebhook(event({ body: del() }), deps)
    expect(sent).toHaveLength(0)
    expect(puts).toHaveLength(0)
    expect(logs.join("\n")).toContain('"outcome":"owner-flood"')
  })
})

describe("no owner lookup against SourceAccount (0093 criterion 3, code level)", () => {
  /**
   * The IAM half is `ingest-webhook-stack.test.ts`. This is the code half: nothing the webhook
   * bundles can name the SourceAccount table or its store, so there is no lookup to grant.
   */
  it("the bundle contains no SourceAccount store, table name or byExternalOwner index", async () => {
    const result = await build({
      entryPoints: [join(process.cwd(), "amplify/functions/ingest-webhook/handler.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      write: false,
      metafile: true,
      logLevel: "silent",
    })
    const [output] = Object.values(result.metafile.outputs)
    expect(Object.keys(output.inputs).filter((i) => /source-account|lib\/sources\//.test(i))).toEqual([])
    const text = result.outputFiles[0].text
    expect(text).not.toContain("LostSolesSourceAccount")
    expect(text).not.toContain("byExternalOwner")
  }, 60_000)
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
