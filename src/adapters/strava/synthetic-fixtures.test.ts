import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { computeActivityId } from "@/src/domain/activity-id"
import type { IngestJob } from "@/src/adapters/types"
import type { RawArchiveRef } from "@/src/domain/activity"

import { normalizeStrava } from "./normalize"
import { openRawEnvelope } from "./raw-envelope"
import { afterResponse, parseRateLimit } from "./rate-limit"

/**
 * THE FOUR FIXTURES NO REAL ACCOUNT CAN PRODUCE. Ticket 0173, split from 0038.
 *
 * `0038` required ten fixtures and said "every one is a real captured response, not
 * hand-written". Six were captured. These four cannot be, and the reasons are properties of
 * the world rather than of the ticket — see `__fixtures__/README.md` for the table.
 *
 * The point of this file is that being CONSTRUCTED is not the same as being decorative.
 * `0165` is the cautionary tale: 76 green tests built from a design document's worked
 * example, proving the code matched the document while the live service refused every
 * grant. So each fixture here is exercised against real behaviour, and each test says what
 * it locks down rather than merely loading a file.
 */

const FIXTURES = join(import.meta.dirname, "__fixtures__")

const REF: RawArchiveRef = {
  bucket: "lost-soles-raw",
  key: "raw/user-01JQ8Z/strava/9007199254740993/deadbeef.json",
  contentType: "application/json",
  bytes: 1024,
  sha256: "deadbeef",
  archivedAt: "2026-06-01T03:20:11.482Z",
}

const job = (over: Partial<IngestJob> = {}): IngestJob => ({
  ingestKey: "ingest-key",
  userId: "user-01JQ8Z",
  source: "strava",
  externalId: "9007199254740993",
  command: "ingest",
  startedAt: "2026-06-01T02:53:48.000Z",
  meta: { aspectType: "create", hasGpsHint: false },
  enqueuedAt: "2026-06-01T03:19:00.000Z",
  ...over,
})

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * FIXTURE 6 — an activity id above 2^53
 *
 * `0038` calls this "the cheapest insurance in the capability", and the chain it protects
 * is worth restating because every link is silent:
 *
 *   JSON.parse rounds the id  ->  externalId is wrong  ->  computeActivityId is wrong
 *   ->  a re-ingest produces a SECOND activity for one run  ->  XP is awarded twice,
 *   on a ledger that only ever adds (D-135) and a map that never re-fogs (D-020).
 *
 * No error is thrown anywhere along it. The largest real id on the connected account is
 * 20014448765 — 2.0e10 against 2^53 ≈ 9.0e15 — so Strava is five orders of magnitude away
 * from minting one of these and the fixture cannot be captured.
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe("fixture 6 — an id above 2^53 survives the whole chain", () => {
  const NAME = "oversized-activity-id"
  const bytes = readFileSync(join(FIXTURES, `${NAME}.json`))
  const text = bytes.toString("utf8")

  /** The digits Strava put on the wire, taken from the raw text so nothing has parsed them. */
  const WIRE_ID = /"id":(\d+)/.exec(text)![1]
  const WIRE_UPLOAD_ID = /"upload_id":(\d+)/.exec(text)![1]

  it("is genuinely past the precision limit, or this fixture proves nothing", () => {
    expect(Number(WIRE_ID)).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
    expect(Number(WIRE_UPLOAD_ID)).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
    // 2^53 + 1: the SMALLEST integer a double cannot represent. A fixture using a huge
    // round number would pass a check that a fixture one digit past the boundary fails,
    // and it is the boundary that ships.
    expect(WIRE_ID).toBe("9007199254740993")
  })

  it("DEMONSTRATES the corruption a plain JSON.parse causes", () => {
    // Not a hypothetical. This is the failure mode json-ids.ts exists for, shown rather
    // than described — and note there is no error, no warning, just a different number.
    const naive = JSON.parse(text) as { detail: { id: number; upload_id: number } }

    expect(String(naive.detail.id)).not.toBe(WIRE_ID)
    expect(String(naive.detail.id)).toBe("9007199254740992") // one less. Silently.
    expect(String(naive.detail.upload_id)).not.toBe(WIRE_UPLOAD_ID)
  })

  it("openRawEnvelope preserves both ids byte for byte", () => {
    const { detail } = openRawEnvelope(bytes) as {
      detail: { id: string; upload_id: string }
    }
    expect(detail.id).toBe(WIRE_ID)
    expect(detail.upload_id).toBe(WIRE_UPLOAD_ID)
    // Strings, not numbers — that IS the mechanism. §2.7: "All Strava IDs are strings.
    // Always."
    expect(typeof detail.id).toBe("string")
  })

  it("normalize carries it through to the activity untouched", () => {
    const { activity } = normalizeStrava(bytes, REF, job({ externalId: WIRE_ID }))
    expect(activity.source.externalId).toBe(WIRE_ID)
  })

  it("and computeActivityId is derived from the EXACT id, not the rounded one", () => {
    const { activity } = normalizeStrava(bytes, REF, job({ externalId: WIRE_ID }))

    expect(activity.activityId).toBe(computeActivityId("user-01JQ8Z", "strava", WIRE_ID))
    // The whole point: the corrupted id yields a DIFFERENT activityId, which is the second
    // activity, the broken idempotency and the double XP award.
    expect(activity.activityId).not.toBe(
      computeActivityId("user-01JQ8Z", "strava", "9007199254740992"),
    )
  })

  it("re-ingesting the same bytes is idempotent at this id", () => {
    const once = normalizeStrava(bytes, REF, job({ externalId: WIRE_ID }))
    const twice = normalizeStrava(bytes, REF, job({ externalId: WIRE_ID }))
    expect(once.activity.activityId).toBe(twice.activity.activityId)
  })
})

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * FIXTURE 10 — a 429 with the full rate-limit header set
 *
 * Constructed because a real one costs ~1,000 reads of a quota that is per-APPLICATION and
 * shared across every athlete on the client_id (§2.5) — a day of budget, on the only
 * connected account, for a response whose headers are already documented.
 *
 * What makes it more than a hand-wave: the header NAMES and the LIMIT values are exactly
 * those observed on live 200s from client_id 276053 on 2026-09-06. Only the usage counters
 * are moved to their ceilings. The response lives under `__fixtures__/http/` because it is
 * an HTTP response and not an archive envelope, which also keeps `normalize`'s
 * every-fixture sweep from trying to normalize it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface HttpFixture {
  status: number
  headers: Record<string, string>
  body: unknown
}

const http = (name: string): HttpFixture =>
  JSON.parse(readFileSync(join(FIXTURES, "http", `${name}.json`), "utf8")) as HttpFixture

/** Rebuilt as a real `Response`, so the header casing goes through the same path a live one does. */
const asResponse = (f: HttpFixture) =>
  new Response(JSON.stringify(f.body), { status: f.status, headers: f.headers })

describe("fixture 10 — a 429 drives the boundary sleep", () => {
  const NOW = Date.parse("2026-09-06T10:07:30Z")
  const noJitter = () => 0

  it("carries the four headers §2.5 names, with the limits observed live", () => {
    const s = parseRateLimit(asResponse(http("429-rate-limited")).headers)
    expect(s.read).toEqual({
      fifteenMin: { usage: 100, limit: 100 },
      daily: { usage: 431, limit: 1000 },
    })
    expect(s.overall).toEqual({
      fifteenMin: { usage: 100, limit: 200 },
      daily: { usage: 431, limit: 2000 },
    })
  })

  it("sleeps to the next quarter hour when the 15-minute bucket is the exhausted one", () => {
    const f = http("429-rate-limited")
    const d = afterResponse(f.status, asResponse(f).headers, NOW, 1, noJitter)
    expect(d).toMatchObject({
      action: "sleep",
      untilMs: Date.parse("2026-09-06T10:15:00Z"),
    })
  })

  it("sleeps to midnight UTC when the DAILY bucket is the exhausted one", () => {
    // The distinction that stops a worker waking every 15 minutes all night against a
    // limit that only resets at midnight.
    const f = http("429-daily-exhausted")
    const d = afterResponse(f.status, asResponse(f).headers, NOW, 1, noJitter)
    expect(d).toMatchObject({
      action: "sleep",
      untilMs: Date.parse("2026-09-07T00:00:00Z"),
    })
  })

  it("is never an immediate retry and never a blind backoff", () => {
    for (const name of ["429-rate-limited", "429-daily-exhausted"]) {
      const f = http(name)
      const d = afterResponse(f.status, asResponse(f).headers, NOW, 1, noJitter)
      expect(d.action).not.toBe("retry")
      expect(d.action).not.toBe("proceed")
    }
  })

  it("the two 429 fixtures differ ONLY in the daily counter", () => {
    // If they ever drift apart in some other field, the pair stops isolating the one
    // variable it was built to isolate.
    const a = http("429-rate-limited")
    const b = http("429-daily-exhausted")
    expect(a.status).toBe(b.status)
    expect(a.headers["x-readratelimit-limit"]).toBe(b.headers["x-readratelimit-limit"])
    expect(a.headers["x-readratelimit-usage"]).not.toBe(b.headers["x-readratelimit-usage"])
  })
})

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * FIXTURES 2 and 9 — the TrailRun and the novel sport_type
 *
 * Both already existed and both are already exercised by `kind-selection.test.ts` and the
 * every-fixture sweep. What was missing is the RECORD of why they are constructed, which
 * now lives in `__fixtures__/README.md`. These two assertions make that record load-bearing
 * rather than prose: if the account ever does produce a real divergence or a novel type,
 * these are the tests that should be replaced by a capture.
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe("fixtures 2 and 9 — constructed, and stated to be", () => {
  it("fixture 2 carries a type/sport_type divergence, which the account has never produced", () => {
    const { detail } = openRawEnvelope(
      readFileSync(join(FIXTURES, "trailrun-legacy-type-mismatch.json")),
    ) as { detail: { type: string; sport_type: string } }

    // The legacy `type` says Run; the modern `sport_type` says TrailRun. Six years and 104
    // activities on the connected account contain zero such pairs — every one is
    // Run/Run, Ride/Ride, Walk/Walk or Workout/Workout.
    expect(detail.type).toBe("Run")
    expect(detail.sport_type).toBe("TrailRun")
    expect(detail.type).not.toBe(detail.sport_type)
  })

  it("fixture 9 carries a sport_type no Strava release has shipped", () => {
    const { detail } = openRawEnvelope(
      readFileSync(join(FIXTURES, "unknown-sport-type.json")),
    ) as { detail: { sport_type: string } }

    // Deliberately absurd. A plausible-but-unshipped value would quietly become correct
    // the day Strava shipped it, and the fixture would stop testing the unknown branch
    // without anyone noticing.
    expect(detail.sport_type).toBe("CoastalRowingWithJetpack")
  })
})
