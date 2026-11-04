import { afterEach, describe, expect, it, vi } from "vitest"

import { LogRefusedError } from "./queue"
import { errorFrom, LOG_PATH, sendLog } from "./transport"

const ENTRY = { exerciseId: "pushup", sets: [{ reps: 20 }], occurredAt: "2026-11-02T08:00:00.000Z", idempotencyKey: "k-1" }

/**
 * `0331`, D-472: `sendLog` posts to `/api/log` on this origin, sends no user id, and only a `422`
 * carrying `REFUSED:` drops the entry. A signed-out 404, a 403 or a 502 stays queued.
 */
describe("sendLog over POST /api/log", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const respond = (status: number, body: unknown) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetch)
    return fetch
  }

  it("posts the entry same-origin, with no user id, and returns the result", async () => {
    const fetch = respond(200, { logged: true, xpAwarded: 12 })
    expect(await sendLog(ENTRY as never)).toEqual({ logged: true, xpAwarded: 12 })
    const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe(LOG_PATH)
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" })
    expect(JSON.parse(String(init.body))).toEqual({ ...ENTRY, timezone: null })
  })

  it("maps a 422 refusal to LogRefusedError, so the queue drops it", async () => {
    respond(422, { errors: [{ message: "REFUSED:UNKNOWN_EXERCISE: nope" }] })
    await expect(sendLog(ENTRY as never)).rejects.toBeInstanceOf(LogRefusedError)
  })

  it("treats a signed-out 404, a 403 and a 502 as retryable", async () => {
    for (const [status, body] of [
      [404, { error: "not found" }],
      [403, { error: "forbidden" }],
      [502, { errors: [{ message: "logWorkout failed" }] }],
    ] as const) {
      respond(status, body)
      const error = await sendLog(ENTRY as never).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(LogRefusedError)
    }
  })
})

/**
 * The one decision the transport makes: is a GraphQL error a refusal (drop it) or a failure
 * (retry it)? The Lambda prefixes client-caused errors `REFUSED:<code>:` (0069); everything else
 * — a timeout, a 5xx, a cold start — must retry, because the queue's whole promise is that a
 * log is never lost to a bad moment.
 */
describe("errorFrom", () => {
  it("maps the Lambda's REFUSED prefix to a refusal with its code", () => {
    const e = errorFrom([{ message: "REFUSED:UNKNOWN_EXERCISE: no enabled skill logs exercise \"x\"" }])
    expect(e).toBeInstanceOf(LogRefusedError)
    expect((e as LogRefusedError).code).toBe("UNKNOWN_EXERCISE")
  })

  it("finds the refusal among several errors", () => {
    expect(errorFrom([{ message: "noise" }, { message: "REFUSED:NOT_OWNER:" }])).toBeInstanceOf(LogRefusedError)
  })

  it("treats everything else as retryable", () => {
    for (const message of ["Network error", "Lambda timed out", "Unauthorized", "refused: lowercase is not the prefix"]) {
      expect(errorFrom([{ message }])).not.toBeInstanceOf(LogRefusedError)
    }
    expect(errorFrom([{ errorType: "Lambda:Unhandled" }]).message).toContain("Lambda:Unhandled")
  })
})

describe("a split log on the wire (0342, D-483)", () => {
  afterEach(() => vi.unstubAllGlobals())
  it("sends the split as said, and not the derived sets", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ logged: true, xpAwarded: 1 }), { status: 200, headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetch)
    const split = { durationS: 2700, shares: [{ exerciseId: "a", percent: 100 }] }
    await sendLog({ ...ENTRY, exerciseId: "s", sets: [{ exercise: "a", durationS: 2700 }], split } as never)
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.split).toEqual(split)
    expect(body).not.toHaveProperty("sets")
  })
})
