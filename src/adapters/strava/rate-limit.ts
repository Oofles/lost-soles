/**
 * RATE LIMITS AND BACKOFF. Ticket 0038, `03-integrations.md` §2.5.
 *
 * THE FACT THAT DRIVES EVERYTHING HERE: **limits are per-APPLICATION, not per-athlete.**
 * The quota attaches to the `client_id` and is shared across every athlete who has
 * authorized the app, so adding a user does not add quota — it SPLITS it. §2.5 calls this
 * the single most misunderstood fact about the Strava API.
 *
 * Default tier: 100 reads / 15 min, 1,000 reads / day (overall 200 / 2,000). Every call
 * Lost Soles makes is a read, so the read bucket is the only one that ever binds.
 *
 * ─── READ THE HEADERS; DO NOT MODEL THE BUDGET LOCALLY ──────────────────────
 *
 * A locally-counted budget is wrong the moment anything else spends from the same quota —
 * a second Lambda, a retry, a manual curl, a second athlete. It is also wrong after every
 * cold start, because the count goes back to zero while the window does not. Strava puts
 * the true usage on EVERY response, including error responses, which is the one place it
 * cannot drift:
 *
 *   X-RateLimit-Limit:      200,2000      # overall:  15min,daily
 *   X-RateLimit-Usage:      12,431
 *   X-ReadRateLimit-Limit:  100,1000      # read:     15min,daily
 *   X-ReadRateLimit-Usage:  12,431
 *
 * ─── AND DO NOT EXPONENTIAL-BACKOFF A FIXED WINDOW ──────────────────────────
 *
 * The 15-minute window resets on a natural boundary — :00, :15, :30, :45 — and the daily
 * one at midnight UTC. Those are wall-clock facts, not a function of how long you have
 * been waiting. Exponential backoff against a fixed window is strictly worse than waiting
 * for the boundary: it either wakes too early and spends another 429 (which still costs a
 * request against a shared quota) or overshoots and idles past the reset. Sleep to the
 * boundary. §2.5 spells this out and it is easy to "improve" back into a bug.
 */

/** §2.5. Pause the backfill worker once the bucket is this full, leaving the rest for the
 *  interactive path — "sync now" and the backfill draw on the same quota. */
export const PAUSE_AT_FRACTION = 0.9

export const FIFTEEN_MIN_MS = 15 * 60 * 1000
export const DAY_MS = 24 * 60 * 60 * 1000

/** Transient-failure backoff: 1s, 2s, 4s, 8s, then give up. §2.5. */
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000] as const
export const MAX_ATTEMPTS = 5

export interface Bucket {
  /** Requests spent in the current window. */
  usage: number
  /** The window's ceiling. */
  limit: number
}

export interface RateLimitStatus {
  /** The read bucket — the only one that binds, since every call we make is a read. */
  read: { fifteenMin: Bucket; daily: Bucket } | null
  /** The overall bucket, parsed for completeness and for the logs. */
  overall: { fifteenMin: Bucket; daily: Bucket } | null
}

/** `"12,431"` → `[12, 431]`. Returns null on anything that is not that shape. */
function pair(value: string | null): [number, number] | null {
  if (!value) return null
  const parts = value.split(",").map((p) => Number(p.trim()))
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null
  return [parts[0], parts[1]]
}

/** Header access that works for a `Headers`, and for the plain object a test may pass. */
type HeaderSource = Headers | Record<string, string | undefined>
function header(h: HeaderSource, name: string): string | null {
  if (typeof (h as Headers).get === "function") return (h as Headers).get(name)
  const rec = h as Record<string, string | undefined>
  // HTTP header names are case-insensitive and Node lower-cases them; a hand-written
  // literal in a test will not be. Look both ways rather than making the caller care.
  return rec[name] ?? rec[name.toLowerCase()] ?? null
}

/**
 * Parses the four headers off ANY response, including a 429 and a 500.
 *
 * Error responses are the ones that matter most: a 429 is precisely when the budget needs
 * reading, and a handler that only parsed 2xx would go blind at the moment it must not.
 */
export function parseRateLimit(headers: HeaderSource): RateLimitStatus {
  const build = (limitName: string, usageName: string) => {
    const limit = pair(header(headers, limitName))
    const usage = pair(header(headers, usageName))
    if (!limit || !usage) return null
    return {
      fifteenMin: { usage: usage[0], limit: limit[0] },
      daily: { usage: usage[1], limit: limit[1] },
    }
  }
  return {
    read: build("X-ReadRateLimit-Limit", "X-ReadRateLimit-Usage"),
    overall: build("X-RateLimit-Limit", "X-RateLimit-Usage"),
  }
}

/** Next :00 / :15 / :30 / :45 boundary strictly after `now`. */
export function nextQuarterHour(now: number): number {
  return Math.floor(now / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS + FIFTEEN_MIN_MS
}

/** Next 00:00 UTC strictly after `now`. */
export function nextUtcMidnight(now: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS + DAY_MS
}

export type Decision =
  | { action: "proceed" }
  | { action: "sleep"; untilMs: number; reason: string }
  | { action: "retry"; delayMs: number; attempt: number }
  | { action: "fail"; reason: string }

/**
 * SHOULD A CALL BE ISSUED AT ALL? Checked BEFORE a request goes out (criterion 10), so a
 * backfill that has run out of quota degrades to "resume tomorrow" rather than spending
 * its remaining attempts discovering a window that is already shut.
 *
 * `interactive` skips the pause. The 10% the backfill leaves alone IS the interactive
 * reserve (§2.5) — a user pressing "sync now" is allowed into it, a background worker is
 * not. Without that distinction the reserve would be indistinguishable from a lower limit.
 */
export function budgetCheck(
  status: RateLimitStatus,
  now: number,
  { interactive = false } = {},
): Decision {
  const read = status.read
  // No headers yet — the first call of a cold start has nothing to go on. Proceeding is
  // correct: the response will carry the headers, and refusing would deadlock a worker
  // that can only learn the budget by spending one request on it.
  if (!read) return { action: "proceed" }

  if (read.daily.usage >= read.daily.limit) {
    return { action: "sleep", untilMs: nextUtcMidnight(now), reason: "daily read budget exhausted" }
  }
  if (read.fifteenMin.usage >= read.fifteenMin.limit) {
    return { action: "sleep", untilMs: nextQuarterHour(now), reason: "15-minute read budget exhausted" }
  }
  if (interactive) return { action: "proceed" }

  if (read.daily.usage >= PAUSE_AT_FRACTION * read.daily.limit) {
    return {
      action: "sleep",
      untilMs: nextUtcMidnight(now),
      reason: `daily read budget at ${read.daily.usage}/${read.daily.limit} — holding the last 10% for the interactive path`,
    }
  }
  if (read.fifteenMin.usage >= PAUSE_AT_FRACTION * read.fifteenMin.limit) {
    return {
      action: "sleep",
      untilMs: nextQuarterHour(now),
      reason: `15-minute read budget at ${read.fifteenMin.usage}/${read.fifteenMin.limit} — holding the last 10% for the interactive path`,
    }
  }
  return { action: "proceed" }
}

/**
 * WHAT TO DO WITH A RESPONSE THAT CAME BACK.
 *
 * `attempt` is 1-based and counts attempts already made.
 *
 * `random` is injected so a test can assert the jitter WINDOW rather than a value, and so
 * this stays a pure function of its arguments — `Math.random` in here would make every
 * backoff assertion flaky or fictional.
 */
export function afterResponse(
  status: number,
  headers: HeaderSource,
  now: number,
  attempt: number,
  random: () => number = Math.random,
): Decision {
  if (status >= 200 && status < 300) return { action: "proceed" }

  if (status === 429) {
    /**
     * A 429 IS NOT A TRANSIENT ERROR AND MUST NOT BE BACKED OFF EXPONENTIALLY. The window
     * is fixed: sleeping 1s then 2s then 4s against a boundary 11 minutes away spends four
     * more requests, each of which is itself a read against a shared quota, to learn
     * something the clock already knew.
     *
     * WHICH bucket is exhausted decides how long. Reading it off the headers rather than
     * assuming the 15-minute one is what stops a worker waking every quarter hour all
     * night against a daily limit that resets at midnight.
     */
    const read = parseRateLimit(headers).read
    const dailyExhausted = read ? read.daily.usage >= read.daily.limit : false
    const untilMs = dailyExhausted ? nextUtcMidnight(now) : nextQuarterHour(now)
    // §2.5's "+ 5s jitter": every worker sharing this client_id wakes on the same
    // boundary, and waking simultaneously re-exhausts the window in one burst.
    return {
      action: "sleep",
      untilMs: untilMs + Math.floor(random() * 5000),
      reason: dailyExhausted ? "429, daily bucket — sleeping to 00:00 UTC" : "429 — sleeping to the next quarter hour",
    }
  }

  /**
   * A 4xx THAT IS NOT 429 IS NOT RETRIED (criterion 9). A 400 or a 404 will be a 400 or a
   * 404 on the fifth attempt too; retrying spends quota to reach the same answer more
   * slowly. 401 is handled a layer up, in `client.ts`, because it is repaired by a token
   * refresh rather than by waiting.
   */
  if (status >= 400 && status < 500) {
    return { action: "fail", reason: `HTTP ${status} is not retryable` }
  }

  // 5xx and network errors: exponential backoff with FULL jitter.
  return backoff(attempt, random)
}

/**
 * 1s → 2s → 4s → 8s, max 5 attempts, FULL jitter.
 *
 * "Full" jitter means uniform over [0, delay], not delay ± a wobble. The failure it
 * prevents is a thundering herd: N workers that failed together retry together, and a
 * narrow jitter band keeps them together through every subsequent round. Uniform spread
 * decorrelates them on the first retry.
 */
export function backoff(attempt: number, random: () => number = Math.random): Decision {
  if (attempt >= MAX_ATTEMPTS) {
    return { action: "fail", reason: `${MAX_ATTEMPTS} attempts exhausted` }
  }
  const base = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length) - 1]
  return { action: "retry", delayMs: Math.floor(random() * base), attempt: attempt + 1 }
}

/**
 * KEEP THE LAST KNOWN READING WHEN A RESPONSE CARRIES NO HEADERS.
 *
 * §2.5 says the headers are on "every response", and a live probe on 2026-09-06 found that
 * they are not:
 *
 *   authenticated 200                      headers PRESENT
 *   authenticated 400 (bad parameter)      headers PRESENT
 *   authenticated 404 (other's activity)   headers PRESENT
 *   authenticated 404 on /streams          headers ABSENT   <- and this one is routine
 *   unauthenticated 401                    headers ABSENT
 *
 * The `/streams` 404 is not an edge case: §2.6 makes it the ordinary answer for every
 * manual and GPS-less activity, so a backfill over a mixed history hits it constantly.
 *
 * Without this, the hole is quiet and one-directional. `parseRateLimit` correctly returns
 * `null` rather than zeroes, and `budgetCheck` correctly proceeds on `null` — a caller that
 * simply assigned each response's status would therefore FORGET a 97%-full bucket the
 * moment it touched a manual activity, and resume at full speed. Every piece behaving
 * correctly on its own, combining into an unthrottled worker.
 *
 * So the rule is: a response with no headers carries no NEWS about the budget, and no news
 * is not good news (D-176). Usage only ever moves forward from what was last observed.
 */
export function mergeRateLimit(
  previous: RateLimitStatus | null,
  incoming: RateLimitStatus,
): RateLimitStatus {
  if (!previous) return incoming
  return {
    read: incoming.read ?? previous.read,
    overall: incoming.overall ?? previous.overall,
  }
}
