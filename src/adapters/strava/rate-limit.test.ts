import { describe, expect, it } from "vitest"

import {
  DAY_MS,
  MAX_ATTEMPTS,
  PAUSE_AT_FRACTION,
  RETRY_DELAYS_MS,
  afterResponse,
  backoff,
  budgetCheck,
  mergeRateLimit,
  nextQuarterHour,
  nextUtcMidnight,
  parseRateLimit,
} from "./rate-limit"

/** Real headers, captured from a live 200 while building this ticket. */
const LIVE = {
  "x-ratelimit-limit": "200,2000",
  "x-ratelimit-usage": "1,37",
  "x-readratelimit-limit": "100,1000",
  "x-readratelimit-usage": "1,37",
}

const at = (iso: string) => Date.parse(iso)
const headers = (read: string, limit = "100,1000") => ({
  "x-readratelimit-limit": limit,
  "x-readratelimit-usage": read,
})

describe("parsing the headers off every response", () => {
  it("reads the real header set a live 200 returned", () => {
    const s = parseRateLimit(LIVE)
    expect(s.read).toEqual({
      fifteenMin: { usage: 1, limit: 100 },
      daily: { usage: 37, limit: 1000 },
    })
    expect(s.overall).toEqual({
      fifteenMin: { usage: 1, limit: 200 },
      daily: { usage: 37, limit: 2000 },
    })
  })

  it("reads them off a 429 too — the response where the budget matters most", () => {
    // A handler that only parsed 2xx would go blind at exactly the moment it must not.
    const res = new Response("Rate Limit Exceeded", { status: 429, headers: LIVE })
    expect(parseRateLimit(res.headers).read?.daily).toEqual({ usage: 37, limit: 1000 })
  })

  it("works with a real Headers object, which lower-cases every name", () => {
    const res = new Response("", { headers: { "X-ReadRateLimit-Limit": "100,1000", "X-ReadRateLimit-Usage": "5,50" } })
    expect(parseRateLimit(res.headers).read?.fifteenMin).toEqual({ usage: 5, limit: 100 })
  })

  it("returns null rather than zero when the headers are absent", () => {
    // Zero would read as "no budget spent" and let a worker run flat out on no evidence.
    // D-176: not knowing must never be indistinguishable from knowing it is fine.
    expect(parseRateLimit({}).read).toBeNull()
  })

  it("returns null on a malformed value rather than guessing at it", () => {
    expect(parseRateLimit(headers("garbage")).read).toBeNull()
    expect(parseRateLimit(headers("1")).read).toBeNull()
  })
})

describe("the four natural boundaries, on a frozen clock", () => {
  // Criterion 7: "a test with a frozen clock asserts the computed wake time for each of
  // the four boundaries". Windows reset on :00, :15, :30 and :45 — wall-clock facts, not
  // a function of how long anyone has been waiting.
  const CASES: Array<[string, string]> = [
    ["2026-09-06T10:00:00.000Z", "2026-09-06T10:15:00.000Z"],
    ["2026-09-06T10:07:30.000Z", "2026-09-06T10:15:00.000Z"],
    ["2026-09-06T10:14:59.999Z", "2026-09-06T10:15:00.000Z"],
    ["2026-09-06T10:15:00.000Z", "2026-09-06T10:30:00.000Z"],
    ["2026-09-06T10:29:59.999Z", "2026-09-06T10:30:00.000Z"],
    ["2026-09-06T10:30:00.000Z", "2026-09-06T10:45:00.000Z"],
    ["2026-09-06T10:44:59.999Z", "2026-09-06T10:45:00.000Z"],
    ["2026-09-06T10:45:00.000Z", "2026-09-06T11:00:00.000Z"],
  ]

  for (const [now, expected] of CASES) {
    it(`${now} wakes at ${expected}`, () => {
      expect(new Date(nextQuarterHour(at(now))).toISOString()).toBe(expected)
    })
  }

  it("crosses midnight without going backwards", () => {
    expect(new Date(nextQuarterHour(at("2026-09-06T23:52:00Z"))).toISOString()).toBe(
      "2026-09-07T00:00:00.000Z",
    )
  })

  it("computes the daily reset as 00:00 UTC", () => {
    expect(new Date(nextUtcMidnight(at("2026-09-06T10:07:30Z"))).toISOString()).toBe(
      "2026-09-07T00:00:00.000Z",
    )
    // Exactly on the boundary must advance a whole day, not return itself and spin.
    expect(new Date(nextUtcMidnight(at("2026-09-06T00:00:00Z"))).toISOString()).toBe(
      "2026-09-07T00:00:00.000Z",
    )
  })
})

describe("the budget is checked BEFORE the call goes out", () => {
  const NOW = at("2026-09-06T10:07:30Z")

  it("proceeds on an ordinary budget", () => {
    expect(budgetCheck(parseRateLimit(LIVE), NOW)).toEqual({ action: "proceed" })
  })

  it("proceeds on the very first call, when no headers have been seen", () => {
    // Refusing would deadlock: the only way to learn the budget is to spend one request.
    expect(budgetCheck(parseRateLimit({}), NOW)).toEqual({ action: "proceed" })
  })

  it("pauses the backfill at 90% of the 15-minute bucket, not at 100%", () => {
    const d = budgetCheck(parseRateLimit(headers("90,100")), NOW)
    expect(d.action).toBe("sleep")
    expect(d).toMatchObject({ untilMs: at("2026-09-06T10:15:00Z") })
  })

  it("pauses the backfill at 90% of the DAILY bucket, and sleeps to midnight", () => {
    const d = budgetCheck(parseRateLimit(headers("5,900")), NOW)
    expect(d).toMatchObject({ action: "sleep", untilMs: at("2026-09-07T00:00:00Z") })
  })

  it("lets the INTERACTIVE path into the last 10% — that reserve is what it is for", () => {
    // §2.5: "sync now" and the backfill draw on the same bucket, and the 10% the backfill
    // leaves alone IS the interactive reserve. Without this the reserve would just be a
    // lower limit.
    expect(budgetCheck(parseRateLimit(headers("95,100")), NOW, { interactive: true })).toEqual({
      action: "proceed",
    })
  })

  it("stops the interactive path too once the bucket is genuinely empty", () => {
    const d = budgetCheck(parseRateLimit(headers("100,500")), NOW, { interactive: true })
    expect(d).toMatchObject({ action: "sleep", untilMs: at("2026-09-06T10:15:00Z") })
  })

  it("prefers the DAILY sleep when both buckets are exhausted", () => {
    // Waking at the quarter hour against an exhausted daily bucket burns a request every
    // 15 minutes until midnight for nothing.
    const d = budgetCheck(parseRateLimit(headers("100,1000")), NOW)
    expect(d).toMatchObject({ action: "sleep", untilMs: at("2026-09-07T00:00:00Z") })
  })

  it("uses 0.9 as the pause fraction, per §2.5", () => {
    expect(PAUSE_AT_FRACTION).toBe(0.9)
  })
})

describe("a 429 sleeps to the boundary — never an immediate retry, never blind backoff", () => {
  const NOW = at("2026-09-06T10:07:30Z")
  const never = () => 0 // no jitter, so the boundary itself is assertable

  it("sleeps to the next quarter hour when the 15-minute bucket is the exhausted one", () => {
    const d = afterResponse(429, headers("100,300"), NOW, 1, never)
    expect(d).toMatchObject({ action: "sleep", untilMs: at("2026-09-06T10:15:00Z") })
  })

  it("sleeps to midnight UTC when the DAILY bucket is the exhausted one", () => {
    const d = afterResponse(429, headers("100,1000"), NOW, 1, never)
    expect(d).toMatchObject({ action: "sleep", untilMs: at("2026-09-07T00:00:00Z") })
  })

  it("is never a retry and never a delay-based backoff", () => {
    const d = afterResponse(429, headers("100,300"), NOW, 1, never)
    expect(d.action).not.toBe("retry")
    expect(d.action).not.toBe("proceed")
  })

  it("adds up to 5s of jitter, so workers sharing the client_id do not wake in lockstep", () => {
    const boundary = at("2026-09-06T10:15:00Z")
    const early = afterResponse(429, headers("100,300"), NOW, 1, () => 0)
    const late = afterResponse(429, headers("100,300"), NOW, 1, () => 0.9999)
    expect(early).toMatchObject({ untilMs: boundary })
    expect(late).toMatchObject({ untilMs: boundary + 4999 })
  })

  it("falls back to the quarter hour when a 429 arrives with no headers at all", () => {
    const d = afterResponse(429, {}, NOW, 1, never)
    expect(d).toMatchObject({ action: "sleep", untilMs: at("2026-09-06T10:15:00Z") })
  })
})

describe("4xx that is not 429 is not retried", () => {
  const NOW = at("2026-09-06T10:07:30Z")

  for (const status of [400, 403, 404, 422]) {
    it(`fails immediately on ${status}`, () => {
      const d = afterResponse(status, {}, NOW, 1)
      expect(d.action).toBe("fail")
    })
  }

  it("a 404 is not retried even on the first attempt", () => {
    // It will be a 404 on the fifth attempt too, and each attempt is a read against a
    // quota shared with every other athlete on this client_id.
    expect(afterResponse(404, {}, NOW, 1).action).toBe("fail")
  })
})

describe("5xx and network errors back off 1/2/4/8 with full jitter", () => {
  const NOW = at("2026-09-06T10:07:30Z")

  it("uses the delays §2.5 specifies", () => {
    expect([...RETRY_DELAYS_MS]).toEqual([1000, 2000, 4000, 8000])
    expect(MAX_ATTEMPTS).toBe(5)
  })

  it("doubles the ceiling on each attempt", () => {
    const top = () => 0.9999
    expect(backoff(1, top)).toMatchObject({ action: "retry", attempt: 2 })
    expect((backoff(1, top) as { delayMs: number }).delayMs).toBeCloseTo(999, -1)
    expect((backoff(2, top) as { delayMs: number }).delayMs).toBeCloseTo(1999, -1)
    expect((backoff(3, top) as { delayMs: number }).delayMs).toBeCloseTo(3999, -1)
    expect((backoff(4, top) as { delayMs: number }).delayMs).toBeCloseTo(7999, -1)
  })

  it("is FULL jitter — uniform over [0, delay], not delay plus a wobble", () => {
    // The failure full jitter prevents: N workers that failed together retry together, and
    // a narrow band keeps them together through every subsequent round.
    expect((backoff(4, () => 0) as { delayMs: number }).delayMs).toBe(0)
    expect((backoff(4, () => 0.5) as { delayMs: number }).delayMs).toBe(4000)
    expect((backoff(4, () => 0.9999) as { delayMs: number }).delayMs).toBe(7999)
  })

  it("gives up cleanly after 5 attempts, for the DLQ", () => {
    expect(backoff(MAX_ATTEMPTS)).toMatchObject({ action: "fail" })
    expect(afterResponse(500, {}, NOW, MAX_ATTEMPTS)).toMatchObject({ action: "fail" })
  })

  for (const status of [500, 502, 503, 504]) {
    it(`retries ${status}`, () => {
      expect(afterResponse(status, {}, NOW, 1).action).toBe("retry")
    })
  }

  it("proceeds on a 2xx", () => {
    expect(afterResponse(200, LIVE, NOW, 1)).toEqual({ action: "proceed" })
  })
})

describe("the budget math §2.5 records, asserted so a change is visible", () => {
  it("steady state fits in under 1% of the daily read budget", () => {
    const perDay = 1 /* webhook detail */ + 1 /* streams */ + 4 /* reconciliation sweeps */
    expect(perDay).toBeLessThan(0.01 * 1000)
  })

  it("the backfill takes about 2.3 days at 70% of quota", () => {
    const STREAM_CALLS = 1600 // 8 years x ~200 runs
    const days = STREAM_CALLS / (0.7 * 1000)
    expect(days).toBeGreaterThan(2)
    expect(days).toBeLessThan(2.5)
  })

  it("a day is a day", () => {
    expect(DAY_MS).toBe(86_400_000)
  })
})

describe("a response with no headers carries no news about the budget", () => {
  /**
   * Found by a LIVE probe while closing 0038, not by reading §2.5 — which says the headers
   * are on "every response" and is wrong about it. An authenticated 404 from `/streams` has
   * none, and §2.6 makes that the ordinary answer for every manual and GPS-less activity.
   */
  const NOW = at("2026-09-06T10:07:30Z")
  const nearlyFull = parseRateLimit(headers("97,900"))
  const silent = parseRateLimit({})

  it("keeps a nearly-exhausted reading across a header-less response", () => {
    const merged = mergeRateLimit(nearlyFull, silent)
    expect(merged.read?.fifteenMin).toEqual({ usage: 97, limit: 100 })
  })

  it("so the worker STAYS paused instead of resuming at full speed", () => {
    // The bug this prevents, spelled out: every piece is individually correct —
    // parseRateLimit returns null rather than zeroes, budgetCheck proceeds on null — and a
    // caller that just assigned each response's status would forget a 97%-full bucket the
    // moment it touched a manual activity.
    expect(budgetCheck(silent, NOW).action).toBe("proceed") // each piece, correct alone
    expect(budgetCheck(mergeRateLimit(nearlyFull, silent), NOW).action).toBe("sleep")
  })

  it("takes the fresher reading when one actually arrives", () => {
    const fresh = parseRateLimit(headers("3,40"))
    expect(mergeRateLimit(nearlyFull, fresh).read?.fifteenMin).toEqual({ usage: 3, limit: 100 })
  })

  it("merges each bucket independently", () => {
    const onlyRead = parseRateLimit({ "x-readratelimit-limit": "100,1000", "x-readratelimit-usage": "5,50" })
    const merged = mergeRateLimit(parseRateLimit(LIVE), onlyRead)
    expect(merged.read?.fifteenMin.usage).toBe(5)
    expect(merged.overall?.fifteenMin.usage).toBe(1) // preserved from the earlier reading
  })

  it("accepts the first reading when there is no previous one", () => {
    expect(mergeRateLimit(null, nearlyFull)).toBe(nearlyFull)
  })
})
