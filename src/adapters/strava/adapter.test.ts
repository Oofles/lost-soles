import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import type { IngestJob } from "../types"
import {
  ingestKeyFor,
  stravaAdapter,
  StravaApiError,
  type StravaCreds,
  type StravaIngestMeta,
} from "./adapter"
import { SOURCE_TEXT_AVAILABLE } from "./json-ids"
import { assertStreamsAligned, openRawEnvelope, uploadIdOf } from "./raw-envelope"

/**
 * Ticket 0034. `listSince` is the reconciliation sweep that covers SILENTLY DROPPED
 * webhooks — Strava retries three times then drops the event permanently, with no DLQ and
 * no replay (`03-integrations.md` §2.3). Without this there is no way to notice a run went
 * missing, so the tests are written against loss rather than against the happy path.
 */

const USER = "b3f1c2d4-0000-4000-8000-000000000001"
const WATERMARK = "2026-09-01T00:00:00.000Z"
const NOW = new Date("2026-09-10T12:00:00.000Z")

/** One summary activity, shaped as the list endpoint returns it. Ids are JSON NUMBERS. */
const activity = (id: number | string, over: Record<string, unknown> = {}) => ({
  id,
  athlete: { id: 51449053 },
  start_date: "2026-09-09T07:15:00Z",
  sport_type: "Run",
  manual: false,
  map: { id: "a123", summary_polyline: "eo~F~ps|U_ulLnnqC" },
  distance: 10442.5,
  ...over,
})

/**
 * A fake Strava. Each entry is one page's JSON TEXT — text and not objects, because
 * `listSince` parses the source characters to keep ids exact, and handing it pre-parsed
 * objects would skip the thing most worth testing.
 */
function harness(pages: string[], opts: { status?: number } = {}) {
  const requests: URL[] = []

  const creds: StravaCreds = {
    accessToken: async () => "access-v1",
    markNeedsReauth: async () => {},
    now: () => NOW,
    fetch: (async (url: URL) => {
      requests.push(new URL(String(url)))
      const body = pages.shift() ?? "[]"
      return new Response(body, { status: opts.status ?? 200 })
    }) as unknown as typeof fetch,
  }

  return { creds, requests }
}

const page = (count: number, startId = 1) =>
  JSON.stringify(Array.from({ length: count }, (_, i) => activity(startId + i)))

async function collect(creds: StravaCreds, watermark = WATERMARK): Promise<IngestJob[]> {
  const out: IngestJob[] = []
  for await (const job of stravaAdapter.listSince(USER, watermark, creds)) out.push(job)
  return out
}

describe("criterion 1 — it satisfies SourceAdapter without a cast", () => {
  it("is typed as the adapter interface, with the unbuilt phases naming their tickets", () => {
    // The type check is the compiler's; this asserts the honest half — that calling an
    // unbuilt phase says which ticket builds it rather than failing obscurely later.
    //
    // `fetchRaw` left this list in ticket 0035. `normalize` is 0036's and `accept` is
    // 0093's; the adapter joins `registry.ts`'s ADAPTERS when `normalize` lands, so that
    // `getAdapter("strava")` never hands back something that fails on a phase.
    expect(stravaAdapter.id).toBe("strava")
    expect(() => stravaAdapter.normalize(Buffer.from(""), {} as never, {} as never)).toThrow(/0036/)
    expect(() => stravaAdapter.accept({} as never)).toThrow(/0093/)
  })
})

describe("criterion 2 — paging", () => {
  it("requests per_page=200 and pages until a short page", async () => {
    const { creds, requests } = harness([page(200), page(200, 201), page(37, 401)])

    const jobs = await collect(creds)

    expect(jobs).toHaveLength(437)
    expect(requests.map((u) => u.searchParams.get("page"))).toEqual(["1", "2", "3"])
    expect(requests[0].searchParams.get("per_page")).toBe("200")
    expect(requests[0].pathname).toBe("/api/v3/athlete/activities")
  })

  it("stops on a short FIRST page without a second request", async () => {
    const { creds, requests } = harness([page(3)])
    await collect(creds)
    expect(requests).toHaveLength(1)
  })

  it("delivers the final short page's activities rather than dropping them", async () => {
    // The short-page check has to come AFTER yielding, and an early `return` above the
    // loop would silently lose the last page every time.
    const { creds } = harness([page(200), page(2, 201)])
    expect(await collect(creds)).toHaveLength(202)
  })

  it("sends the watermark as epoch seconds in `after`", async () => {
    const { creds, requests } = harness([page(1)])
    await collect(creds, "2026-09-05T06:30:00.000Z")
    expect(requests[0].searchParams.get("after")).toBe(String(Date.parse("2026-09-05T06:30:00.000Z") / 1000))
  })

  it("refuses a watermark that is not an ISO instant", async () => {
    // `Date.parse` would yield NaN, and `after=NaN` asks Strava for everything, forever.
    const { creds } = harness([page(1)])
    await expect(collect(creds, "last tuesday")).rejects.toThrow(/ISO 8601/)
  })

  it("throws on a non-2xx rather than treating it as an empty list", async () => {
    // An empty list means "nothing new". A 500 means "unknown". Conflating them would
    // report a healthy sweep that found nothing, which is how a broken connection hides.
    const { creds } = harness([page(1)], { status: 500 })
    await expect(collect(creds)).rejects.toBeInstanceOf(StravaApiError)
  })
})

/** Criterion 3. */
describe("a consumer that breaks early", () => {
  it("stops the iteration and issues no further HTTP calls", async () => {
    const { creds, requests } = harness([page(200), page(200, 201), page(1, 401)])

    const seen: IngestJob[] = []
    for await (const job of stravaAdapter.listSince(USER, WATERMARK, creds)) {
      seen.push(job)
      break
    }

    expect(seen).toHaveLength(1)
    // ONE request, though three pages were available. `for await` calls `return()` on the
    // generator, which unwinds at the `yield` — so the second page is never fetched.
    expect(requests).toHaveLength(1)
  })

  it("does not materialise the whole backfill to yield the first job", async () => {
    // A generator that built an array first would look identical from the outside until a
    // 1,600-activity backfill ran out of memory in a Lambda.
    const { creds, requests } = harness([page(200), page(200, 201)])
    const iterator = stravaAdapter.listSince(USER, WATERMARK, creds)[Symbol.asyncIterator]()

    await iterator.next()
    expect(requests).toHaveLength(1)
    await iterator.return?.()
  })
})

/** Criteria 4 and 5, at the level of the emitted job. */
describe("ids survive the trip", () => {
  it("emits externalId as an exact string, not a number", async () => {
    const { creds } = harness([JSON.stringify([activity(15134912345)])])
    const [job] = await collect(creds)

    expect(job.externalId).toBe("15134912345")
    expect(typeof job.externalId).toBe("string")
  })

  it("keeps an id past 2^53 byte for byte", async () => {
    const big = "12345678901234567890"
    const { creds } = harness([`[${JSON.stringify(activity(0)).replace('"id":0', `"id":${big}`)}]`])

    if (!SOURCE_TEXT_AVAILABLE) {
      // The documented fallback: refuse, never round. See `json-ids.ts`.
      await expect(collect(creds)).rejects.toThrow(/past 2\^53/)
      return
    }

    const [job] = await collect(creds)
    expect(job.externalId).toBe(big)
  })

  it("refuses an activity whose id is missing or unparseable", async () => {
    const { creds } = harness([JSON.stringify([activity(0, { id: null })])])
    await expect(collect(creds)).rejects.toThrow(/exact integer id/)
  })
})

/** Criterion 6. */
describe("hasGpsHint", () => {
  const hintFor = async (over: Record<string, unknown>) => {
    const { creds } = harness([JSON.stringify([activity(1, over)])])
    const [job] = await collect(creds)
    return (job.meta as StravaIngestMeta).hasGpsHint
  }

  it("is true for an ordinary outdoor run", async () => {
    expect(await hintFor({})).toBe(true)
  })

  it("is false for a manual activity — there was never a recording", async () => {
    expect(await hintFor({ manual: true })).toBe(false)
  })

  it("is false for a treadmill run, which has an EMPTY polyline", async () => {
    // §2.6: an indoor run is a real Activity with `hasTrace: false`. It earns XP; it
    // simply cannot reveal ground, because there is no evidence of which ground.
    expect(await hintFor({ map: { id: "a1", summary_polyline: "" } })).toBe(false)
  })

  it("is false when the map object is absent entirely", async () => {
    expect(await hintFor({ map: undefined })).toBe(false)
  })

  it("saves ticket 0035 a stream call it would learn nothing from", async () => {
    // The point of deciding this from the LIST response: §2.5's budget is spent entirely
    // on stream calls, and the list endpoint is effectively free.
    expect(await hintFor({ manual: true })).toBe(false)
  })
})

/** Criterion 7. */
describe("the polyline is a signal and nothing else", () => {
  it("never reaches the emitted job", async () => {
    const polyline = "eo~F~ps|U_ulLnnqC"
    const { creds } = harness([JSON.stringify([activity(1, { map: { id: "a", summary_polyline: polyline } })])])

    const [job] = await collect(creds)

    // Serialised, because the job is about to be JSON on a queue and that is the form in
    // which a leaked polyline would actually travel.
    expect(JSON.stringify(job)).not.toContain(polyline)
    expect(JSON.stringify(job)).not.toContain("summary_polyline")
  })

  it("appears nowhere outside this adapter directory", () => {
    /**
     * D-121.4. `summary_polyline` is a DECIMATED trace, and a permanent map built from one
     * is permanently wrong. It has exactly two legitimate uses — a bbox prefilter and the
     * has-GPS-at-all signal above — and both live here. Anywhere else is a decode, a
     * render, or a projection, which is the thing that must never happen.
     *
     * Run as a grep rather than asserted about, because the file that reintroduces it is a
     * file that does not exist yet.
     */
    const root = join(import.meta.dirname, "..", "..", "..")
    const adapterDir = join("src", "adapters", "strava")
    /**
     * `scripts/` holds `check-boundaries.mjs`, whose whole job is to carry this word in a
     * pattern. A gate that cannot name what it forbids is not a gate.
     */
    const skip = new Set([
      "node_modules", ".next", ".amplify", ".git", ".npm", "docs", "tickets", "scripts",
    ])

    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        skip.has(e.name)
          ? []
          : e.isDirectory()
            ? walk(join(dir, e.name))
            : /\.(ts|tsx|mjs|js)$/.test(e.name)
              ? [join(dir, e.name)]
              : [],
      )

    /**
     * A COMMENT NAMING IT IS NOT A USE, and the distinction has to be drawn or this test
     * fails on the design's own reasoning. `src/domain/activity.ts` says, on `Trace.simplified`,
     * "Strava's summary_polyline would be true — which is exactly why D-121.4 forbids it."
     * That sentence is the rule being recorded where it will be read; deleting it to satisfy
     * a grep would trade the explanation for the check, which is the wrong way round.
     *
     * Same exemption `check-design-tokens.mjs` already makes for a comment naming a colour.
     */
    const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line)

    const offenders = walk(root)
      .filter((f) => !f.includes(adapterDir))
      .flatMap((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => ({ line, n: i + 1 }))
          .filter(({ line }) => line.includes("summary_polyline") && !isComment(line))
          .map(({ n }) => `${f.slice(root.length + 1)}:${n}`),
      )

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : "D-121.4 — summary_polyline is a decimated trace. Projecting or rendering it\n" +
          "writes a permanently wrong map (D-020). It belongs only to the adapter:\n  " +
          offenders.join("\n  "),
    ).toEqual([])
  })

  it("detects the violation it is looking for", () => {
    // A gate nobody has seen fail is a gate nobody knows works — the same discipline
    // `oauth.test.ts` applies to its lesser-scope grep.
    const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line)
    expect(isComment("  const p = activity.map.summary_polyline")).toBe(false)
    expect(isComment(" * Strava's summary_polyline would be true")).toBe(true)
  })
})

/** Criterion 10, and the ingestKey that makes it true. */
describe("re-running over the same window", () => {
  it("yields the same job set, ingestKey for ingestKey", async () => {
    const first = await collect(harness([page(5)]).creds)
    const second = await collect(harness([page(5)]).creds)

    expect(second.map((j) => j.ingestKey)).toEqual(first.map((j) => j.ingestKey))
    expect(second.map((j) => j.externalId)).toEqual(first.map((j) => j.externalId))
  })

  it("uses the SAME key a webhook `create` would produce, which is the dedupe", async () => {
    /**
     * This looks like a collision and is the entire mechanism. `01-architecture.md` §3
     * step 3 keys the receipt on `sha256("strava:<owner>:<object>:<aspect>")`, so a sweep
     * that finds activity 42 and a webhook that delivered it write the same key — and the
     * conditional PutItem drops the second. A distinct aspect for sweeps would duplicate
     * every activity the webhook already handled.
     */
    const [job] = await collect(harness([JSON.stringify([activity(42)])]).creds)
    expect(job.ingestKey).toBe(ingestKeyFor("51449053", "42"))
  })

  it("keys on the athlete as well as the activity", () => {
    expect(ingestKeyFor("1", "42")).not.toBe(ingestKeyFor("2", "42"))
  })
})

describe("the job's shape", () => {
  it("carries what the consumer needs and nothing vendor-shaped at the top level", async () => {
    const [job] = await collect(harness([JSON.stringify([activity(42)])]).creds)

    expect(job).toMatchObject({
      userId: USER,
      source: "strava",
      externalId: "42",
      command: "ingest",
      enqueuedAt: NOW.toISOString(),
    })
    // The adapter-private half lives in `meta`, which the contract designates for exactly
    // this. Promoting any of it would put one adapter's vocabulary in every adapter's queue.
    expect(job.meta).toEqual({
      aspectType: "create",
      hasGpsHint: true,
      startedAt: "2026-09-09T07:15:00.000Z",
      sportType: "Run",
    })
  })

  it("carries the start date the watermark boundary is computed from", async () => {
    const { creds } = harness([JSON.stringify([activity(1, { start_date: "2026-09-09T07:15:00Z" })])])
    const [job] = await collect(creds)
    expect((job.meta as StravaIngestMeta).startedAt).toBe("2026-09-09T07:15:00.000Z")
  })

  it("refuses an activity with no usable start_date", async () => {
    // Without it the consumer cannot say how far it got, so the watermark would advance on
    // a guess — the one thing `list-since-watermark.ts` exists to prevent.
    const { creds } = harness([JSON.stringify([activity(1, { start_date: undefined })])])
    await expect(collect(creds)).rejects.toThrow(/no usable start_date/)
  })
})

describe("it runs on the 0033 token lifecycle rather than a captured token", () => {
  it("asks for an access token per request, so a refresh mid-sweep is picked up", async () => {
    const tokens = ["t1", "t2", "t3"]
    const accessToken = vi.fn(async () => tokens.shift() ?? "exhausted")
    const seen: string[] = []

    const creds: StravaCreds = {
      accessToken,
      markNeedsReauth: async () => {},
      now: () => NOW,
      fetch: (async (_u: unknown, init?: RequestInit) => {
        seen.push((init?.headers as Record<string, string>).authorization)
        return new Response(seen.length === 1 ? page(200) : page(1, 201), { status: 200 })
      }) as unknown as typeof fetch,
    }

    await collect(creds)

    // A `{ accessToken: string }` credential would have sent "Bearer t1" twice — a token
    // captured at some earlier instant, which is what 0033 exists to stop.
    expect(seen).toEqual(["Bearer t1", "Bearer t2"])
  })
})

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * TICKET 0035 — fetchRaw
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * A synthetic stream of `n` points at ~1 Hz, shaped exactly as the live API returns one —
 * including the `distance` stream Strava adds without being asked.
 *
 * SYNTHETIC AND NOT CAPTURED, deliberately. This repository is PUBLIC, and a real captured
 * `latlng` stream is ~2,700 points of where the operator actually ran, starting outside
 * their front door. Ticket 0168 settles how a real fixture is transformed before anyone
 * commits one; until then the count assertions run on generated geometry, and the point
 * count of a REAL run is verified by a live smoke test at close instead.
 */
const syntheticStreams = (n: number, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    latlng: {
      // A circle, so it is obviously not anywhere: no bearing, no start, no route.
      data: Array.from({ length: n }, (_, i) => [
        Number((51 + 0.01 * Math.cos((i / n) * 2 * Math.PI)).toFixed(6)),
        Number((0.01 * Math.sin((i / n) * 2 * Math.PI)).toFixed(6)),
      ]),
      original_size: n,
      resolution: "high",
      series_type: "distance",
    },
    time: { data: Array.from({ length: n }, (_, i) => i), original_size: n, resolution: "high" },
    altitude: { data: Array.from({ length: n }, () => 12.4), original_size: n, resolution: "high" },
    // Strava returns this without being asked. Verified live.
    distance: { data: Array.from({ length: n }, (_, i) => i * 2.4), original_size: n, resolution: "high" },
    ...over,
  })

const DETAIL_BODY = JSON.stringify({
  id: 18736594040,
  upload_id: 20014448765,
  upload_id_str: "20014448765",
  name: "Evening Run",
  sport_type: "Run",
  type: "Run",
  distance: 3310.4,
  elapsed_time: 1380,
  start_date: "2026-06-01T00:53:48Z",
})

/** A job as `listSince` would have produced it. */
const jobFor = (hasGpsHint: boolean): IngestJob => ({
  ingestKey: "k",
  userId: USER,
  source: "strava",
  externalId: "18736594040",
  command: "ingest",
  meta: { aspectType: "create", hasGpsHint, startedAt: "2026-06-01T00:53:48.000Z", sportType: "Run" },
  enqueuedAt: NOW.toISOString(),
})

function fetchHarness(responses: Array<{ status: number; body: string }>) {
  const urls: URL[] = []
  const creds: StravaCreds = {
    accessToken: async () => "access-v1",
    markNeedsReauth: async () => {},
    now: () => NOW,
    fetch: (async (url: URL) => {
      urls.push(new URL(String(url)))
      const next = responses.shift() ?? { status: 200, body: "{}" }
      return new Response(next.body, { status: next.status })
    }) as unknown as typeof fetch,
  }
  return { creds, urls }
}

const OK_DETAIL = { status: 200, body: DETAIL_BODY }

/** Criteria 1, 2 and 3. */
describe("the streams request", () => {
  it("sends exactly keys and key_by_type — no resolution, no series_type", async () => {
    const { creds, urls } = fetchHarness([OK_DETAIL, { status: 200, body: syntheticStreams(1339) }])
    await stravaAdapter.fetchRaw(jobFor(true), creds)

    const streams = urls[1]
    expect(streams.pathname).toBe("/api/v3/activities/18736594040/streams")
    expect([...streams.searchParams.keys()].sort()).toEqual(["key_by_type", "keys"])

    /**
     * THE CRITERION, as a failing assertion rather than a comment. Both were removed from
     * `getActivityStreams` and are now silently ignored — no error, no effect — so a
     * regression that added them back would look like it worked.
     */
    expect(streams.searchParams.get("resolution")).toBeNull()
    expect(streams.searchParams.get("series_type")).toBeNull()
  })

  it("asks for latlng, time and altitude, with key_by_type true", async () => {
    const { creds, urls } = fetchHarness([OK_DETAIL, { status: 200, body: syntheticStreams(10) }])
    await stravaAdapter.fetchRaw(jobFor(true), creds)

    expect(urls[1].searchParams.get("keys")?.split(",").sort()).toEqual(["altitude", "latlng", "time"])
    expect(urls[1].searchParams.get("key_by_type")).toBe("true")
  })

  it("records the trap at the call site, so the next reader does not 'fix' it back", () => {
    // Criterion 2 is a documentation requirement, so it is checked as one. The comment is
    // the only thing standing between a plausible-looking edit and a silent no-op.
    const source = readFileSync(join(import.meta.dirname, "adapter.ts"), "utf8")
    expect(source).toMatch(/resolution.*series_type.*RESPONSE METADATA/is)
    expect(source).toContain("DO NOT ADD THEM BACK")
  })

  it("fetches the detail before the streams, and both for the same activity", async () => {
    const { creds, urls } = fetchHarness([OK_DETAIL, { status: 200, body: syntheticStreams(10) }])
    await stravaAdapter.fetchRaw(jobFor(true), creds)

    expect(urls.map((u) => u.pathname)).toEqual([
      "/api/v3/activities/18736594040",
      "/api/v3/activities/18736594040/streams",
    ])
  })
})

/** Criterion 7. */
describe("an activity with no GPS", () => {
  it("issues ZERO stream calls — counted, not inferred from the outcome", async () => {
    const { creds, urls } = fetchHarness([OK_DETAIL])
    await stravaAdapter.fetchRaw(jobFor(false), creds)

    // One call, and it is the detail. §3.1 rule 3 archives the activity anyway; there is
    // simply no trace to ask for, and the stream calls are the entire cost of the system.
    expect(urls).toHaveLength(1)
    expect(urls[0].pathname).toBe("/api/v3/activities/18736594040")
  })

  it("still archives the detail, with streams recorded as null", async () => {
    const { creds } = fetchHarness([OK_DETAIL])
    const raw = await stravaAdapter.fetchRaw(jobFor(false), creds)

    const opened = openRawEnvelope(raw.body)
    expect(opened.streams).toBeNull()
    expect(opened.detail).toMatchObject({ sport_type: "Run" })
  })

  it("treats a 404 from /streams as 'no trace', not as an error", async () => {
    /**
     * Confirmed live: a manual activity's streams endpoint answers 404 with
     * `{"message":"Resource Not Found"}` rather than an empty 200 (§2.5). Reachable even
     * when `hasGpsHint` was true, because the hint comes from the LIST response and the
     * two can disagree — a trace removed at the source between the sweep and the fetch.
     * Treating it as an error would retry-loop a permanently unfetchable activity.
     */
    const { creds } = fetchHarness([
      OK_DETAIL,
      { status: 404, body: '{"message":"Resource Not Found"}' },
    ])

    const raw = await stravaAdapter.fetchRaw(jobFor(true), creds)
    expect(openRawEnvelope(raw.body).streams).toBeNull()
  })

  it("throws on any other stream failure rather than archiving a silent gap", async () => {
    const { creds } = fetchHarness([OK_DETAIL, { status: 500, body: "" }])
    await expect(stravaAdapter.fetchRaw(jobFor(true), creds)).rejects.toBeInstanceOf(StravaApiError)
  })

  it("throws when the detail itself fails", async () => {
    const { creds } = fetchHarness([{ status: 500, body: "" }])
    await expect(stravaAdapter.fetchRaw(jobFor(true), creds)).rejects.toBeInstanceOf(StravaApiError)
  })
})

/** Criterion 5. */
describe("the fidelity floor this ticket exists to protect", () => {
  it("carries thousands of points, not the hundreds summary_polyline would give", async () => {
    /**
     * A 45-minute run at ~1 Hz is ~2,700 points; `map.summary_polyline` for the same run is
     * 100-300, Ramer-Douglas-Peucker simplified. The lower bound is set at 1,000 — far above
     * anything RDP would produce and far below a real recording — so the test fails loudly
     * if a decimated source is ever substituted, and does not fail on ordinary variation.
     *
     * The count here is synthetic (ticket 0168 — this repo is public). The equivalent
     * assertion against a REAL run is in this ticket's Operator validation.
     */
    const { creds } = fetchHarness([OK_DETAIL, { status: 200, body: syntheticStreams(2711) }])
    const raw = await stravaAdapter.fetchRaw(jobFor(true), creds)

    const streams = openRawEnvelope(raw.body).streams as Record<string, { data: unknown[] }>
    expect(streams.latlng.data.length).toBe(2711)
    expect(streams.latlng.data.length).toBeGreaterThan(1000)
  })

  it("keeps the streams index-aligned all the way through the archive", async () => {
    const { creds } = fetchHarness([OK_DETAIL, { status: 200, body: syntheticStreams(1339) }])
    const raw = await stravaAdapter.fetchRaw(jobFor(true), creds)

    expect(() => assertStreamsAligned(openRawEnvelope(raw.body).streams)).not.toThrow()
  })

  it("archives a misaligned response rather than refusing to archive it", async () => {
    /**
     * §3.1 rule 1 archives BEFORE the parser is trusted, and rule 5 never deletes on ingest
     * failure. A `fetchRaw` that threw here would destroy the only evidence of what Strava
     * actually sent. The raising happens in `assertStreamsAligned`, which `normalize` calls
     * after the archive PUT — one phase later, costing a replay instead of the payload.
     */
    const misaligned = syntheticStreams(1339, {
      time: { data: [0, 1, 2], original_size: 3, resolution: "high" },
    })
    const { creds } = fetchHarness([OK_DETAIL, { status: 200, body: misaligned }])

    const raw = await stravaAdapter.fetchRaw(jobFor(true), creds)
    expect(raw.body.includes(Buffer.from(misaligned))).toBe(true)
    expect(() => assertStreamsAligned(openRawEnvelope(raw.body).streams)).toThrow()
  })
})

/** Criteria 8 and 9. */
describe("what fetchRaw returns", () => {
  it("labels the payload for the archive", async () => {
    const { creds } = fetchHarness([OK_DETAIL, { status: 200, body: syntheticStreams(10) }])
    const raw = await stravaAdapter.fetchRaw(jobFor(true), creds)

    expect(raw.contentType).toBe("application/json")
    expect(raw.ext).toBe("json")
    expect(Buffer.isBuffer(raw.body)).toBe(true)
  })

  it("performs no transformation on either response", async () => {
    const streamBody = syntheticStreams(10)
    const { creds } = fetchHarness([OK_DETAIL, { status: 200, body: streamBody }])
    const raw = await stravaAdapter.fetchRaw(jobFor(true), creds)

    // Both appear contiguously and unchanged. Any reshaping breaks this.
    expect(raw.body.includes(Buffer.from(DETAIL_BODY))).toBe(true)
    expect(raw.body.includes(Buffer.from(streamBody))).toBe(true)
  })

  it("does not coerce an id in the archived bytes", async () => {
    const big = '{"id":12345678901234567890,"sport_type":"Run"}'
    const { creds } = fetchHarness([{ status: 200, body: big }])
    const raw = await stravaAdapter.fetchRaw(jobFor(false), creds)

    expect(raw.body.toString("utf8")).toContain("12345678901234567890")
    // And it reads back exact, because the reader uses `parseWithExactIds` too.
    expect((openRawEnvelope(raw.body).detail as { id: string }).id).toBe(
      SOURCE_TEXT_AVAILABLE ? "12345678901234567890" : "12345678901234567890",
    )
  })

  it("prefers upload_id_str when reading an upload id back", async () => {
    const { creds } = fetchHarness([OK_DETAIL, { status: 200, body: syntheticStreams(10) }])
    const raw = await stravaAdapter.fetchRaw(jobFor(true), creds)

    expect(uploadIdOf(openRawEnvelope(raw.body).detail)).toBe("20014448765")
  })
})

/** Criterion 4. */
describe("no polyline decoder exists anywhere in this repository", () => {
  it("imports no polyline-decoding dependency, and declares none", () => {
    /**
     * D-121.4. The danger is not that someone writes a decoder — it is that someone adds
     * `@mapbox/polyline` in one line because the summary is free, and the map is quietly
     * built from a decimated trace. By D-020 that is permanent.
     *
     * There is no bbox-prefilter helper yet, so the criterion's exemption has nothing to
     * exempt: the correct current state is zero decoders anywhere.
     */
    const root = join(import.meta.dirname, "..", "..", "..")
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    const declared = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ].filter((d) => /polyline/i.test(d))

    expect(declared).toEqual([])

    const skip = new Set(["node_modules", ".next", ".amplify", ".git", ".npm", "docs", "tickets"])
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        skip.has(e.name)
          ? []
          : e.isDirectory()
            ? walk(join(dir, e.name))
            : /\.(ts|tsx|mjs|js)$/.test(e.name)
              ? [join(dir, e.name)]
              : [],
      )

    const importers = walk(root).filter((f) =>
      /^\s*import\b.*polyline|require\(["'][^"']*polyline/im.test(readFileSync(f, "utf8")),
    )

    expect(importers.map((f) => f.slice(root.length + 1))).toEqual([])
  })
})
