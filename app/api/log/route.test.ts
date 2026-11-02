import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * POST /api/log — ticket `0331`, D-472, D-471.
 *
 * The session and the Lambda client are mocked; the Origin check, the field pick, the payload sent
 * to `log-workout` and the error mapping are real.
 */

let signedInAs: string | undefined

vi.mock("@/lib/auth/owner", () => ({
  currentUserId: async () => signedInAs,
}))

vi.mock("@/lib/aws-server", () => ({
  customOutput: (key: string) => `fn:${key}`,
}))

const sent: { FunctionName?: string; InvocationType?: string; payload: Record<string, unknown> }[] = []
let reply: { FunctionError?: string; Payload?: Uint8Array } = {}
vi.mock("@/lib/http/invoke-as-user", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/http/invoke-as-user")>()
  return {
    ...real,
    defaultLambda: () => ({
      send: async (command: { input: { FunctionName?: string; InvocationType?: string; Payload?: Uint8Array } }) => {
        sent.push({
          FunctionName: command.input.FunctionName,
          InvocationType: command.input.InvocationType,
          payload: JSON.parse(new TextDecoder().decode(command.input.Payload)) as Record<string, unknown>,
        })
        return reply
      },
    }),
  }
})

const { POST } = await import("./route")

const ENTRY = {
  exerciseId: "pushup",
  sets: [{ reps: 20 }],
  occurredAt: "2026-11-02T08:00:00.000Z",
  idempotencyKey: "k-1",
  timezone: "Europe/London",
}

const post = (body: unknown, origin: string | null = "https://soles.devaultsecurity.com") =>
  new Request("https://soles.devaultsecurity.com/api/log", {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))

beforeEach(() => {
  sent.length = 0
  reply = { Payload: json({ logged: true, xpAwarded: 12 }) }
  signedInAs = "u-session"
})

describe("POST /api/log", () => {
  it("404s a signed-out caller and invokes nothing", async () => {
    signedInAs = undefined
    const r = await POST(post(ENTRY))
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: "not found" })
    expect(sent).toEqual([])
  })

  it("invokes log-workout synchronously with the entry and the session's uid", async () => {
    const r = await POST(post(ENTRY))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ logged: true, xpAwarded: 12 })
    expect(r.headers.get("cache-control")).toBe("no-store, private")
    expect(sent).toEqual([{ FunctionName: "fn:logWorkoutFunctionName", InvocationType: "RequestResponse", payload: { ...ENTRY, userId: "u-session" } }])
  })

  /** The SDL's five arguments and nothing else: a body `userId` or `xp` never reaches the Lambda. */
  it("ignores a userId in the body, and every field the mutation never had", async () => {
    await POST(post({ ...ENTRY, userId: "u-other", xp: 999999, skillId: "athletics" }))
    expect(sent[0]!.payload).toEqual({ ...ENTRY, userId: "u-session" })
  })

  it("400s a body that is not a JSON object, and invokes nothing", async () => {
    expect((await POST(post("not json"))).status).toBe(400)
    expect((await POST(post([ENTRY]))).status).toBe(400)
    expect((await POST(post("x".repeat(20_000)))).status).toBe(400)
    expect(sent).toEqual([])
  })

  it("relays a refusal as 422 with the handler's message, so the queue can drop it", async () => {
    reply = { FunctionError: "Unhandled", Payload: json({ errorType: "Error", errorMessage: "REFUSED:UNKNOWN_EXERCISE: no enabled skill logs exercise \"x\"" }) }
    const r = await POST(post(ENTRY))
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ errors: [{ message: "REFUSED:UNKNOWN_EXERCISE: no enabled skill logs exercise \"x\"" }] })
  })

  it("answers a crash with a bare 502, which the queue retries", async () => {
    reply = { FunctionError: "Unhandled", Payload: json({ errorType: "Error", errorMessage: "Task timed out" }) }
    const r = await POST(post(ENTRY))
    expect(r.status).toBe(502)
    expect(await r.json()).toEqual({ errors: [{ message: "logWorkout failed" }] })
  })
})

describe("D-471: a foreign Origin", () => {
  it.each(["https://school-hub.devaultsecurity.com", "https://evil.example", "null"])("from %s is 403 and log-workout is not invoked", async (origin) => {
    const r = await POST(post(ENTRY, origin))
    expect(r.status).toBe(403)
    expect(r.headers.get("cache-control")).toBe("no-store, private")
    expect(sent).toEqual([])
  })
})
