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
    expect(stravaAdapter.id).toBe("strava")
    expect(() => stravaAdapter.normalize(Buffer.from(""), {} as never, {} as never)).toThrow(/0036/)
    expect(() => stravaAdapter.fetchRaw({} as never, {} as never)).toThrow(/0035/)
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
