import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { assertNormalizeIsPure } from "@/src/adapters/normalize-purity"
import type { IngestJob } from "@/src/adapters/types"
import type { RawArchiveRef } from "@/src/domain/activity"

import { stravaAdapter, type StravaIngestMeta } from "./adapter"
import {
  bareIanaZone,
  GAP_THRESHOLD_MS,
  mapSportTypeToKind,
  normalizeStrava,
  stripLyingZ,
} from "./normalize"

/**
 * TICKET 0036 — `normalize()`, the migration seam.
 *
 * Every test here feeds a CHECKED-IN ARCHIVE ENVELOPE, byte for byte as `sealRawEnvelope`
 * writes one to S3, and mocks nothing. That is the property `contracts/ingestion-contract.md`
 * §5 asks of this function and the property the capability `16` rebuild drill depends on:
 * if these fixtures can only be read through a stub, the archive can only be replayed
 * through a stub, and there is no drill.
 *
 * See `__fixtures__/README.md` for why every coordinate in this suite is in the middle of
 * the South Pacific.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, "__fixtures__")

const fixture = (name: string): Buffer => readFileSync(join(FIXTURES, `${name}.json`))

const REF: RawArchiveRef = {
  bucket: "lost-soles-raw",
  key: "raw/user-01JQ8Z/strava/18736594040/deadbeef.json",
  contentType: "application/json",
  bytes: 1024,
  sha256: "deadbeef",
  // The clock. Deliberately LATER than any fixture's `start_date`, and deliberately not
  // round, so a test that accidentally asserts against `startedAt` cannot pass by luck.
  archivedAt: "2026-06-01T03:20:11.482Z",
}

const job = (over: Partial<IngestJob> = {}): IngestJob => ({
  ingestKey: "ingest-key",
  userId: "user-01JQ8Z",
  source: "strava",
  externalId: "18736594040",
  command: "ingest",
  meta: { aspectType: "create", hasGpsHint: true, startedAt: "2026-06-01T02:53:48Z" } satisfies
    StravaIngestMeta,
  enqueuedAt: "2026-06-01T03:19:00.000Z",
  ...over,
})

const run = (name: string, over: Partial<IngestJob> = {}) =>
  normalizeStrava(fixture(name), REF, job(over))

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * PURITY — criteria 2 and 3
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe("normalize is pure", () => {
  /**
   * THE T4 HARNESS FROM 0027, run through the real adapter object rather than the bare
   * function. `fetch`, the AWS SDK's transport, `Date.now()`, `new Date()`, `Math.random`
   * and `crypto.randomUUID` are all stubbed to throw, and it must still return a correct
   * result — then return the identical result a second time.
   */
  it("passes the T4 purity harness on a full-stream fixture", () => {
    const out = assertNormalizeIsPure(stravaAdapter, {
      raw: fixture("run-continuous"),
      ref: REF,
      job: job(),
    })

    expect(out.activity.startedAt).toBe("2026-06-01T02:53:48.000Z")
    expect(out.trace?.pointCount).toBe(6)
  })

  it("passes the T4 purity harness on a fixture with no streams at all", () => {
    const out = assertNormalizeIsPure(stravaAdapter, {
      raw: fixture("treadmill-no-streams"),
      ref: REF,
      job: job({ externalId: "18736594046" }),
    })

    expect(out.trace).toBeUndefined()
    expect(out.activity.hasTrace).toBe(false)
  })

  /**
   * THE STATIC HALF, and it is the half that matters. A runtime stub only catches a call
   * that actually happens, and the impure branch is always the one the fixture did not
   * take — an `await import("@aws-sdk/client-s3")` behind an error path would pass every
   * test above and fail the first time the archive was replayed offline.
   *
   * So: walk this module's LOCAL import graph and read the source. Transitive on purpose —
   * `normalize.ts` importing a tidy helper that imports S3 is the same defect one level
   * down, and it is the version nobody notices in review.
   */
  it("imports no AWS SDK and no HTTP client, transitively", () => {
    const banned = [
      /@aws-sdk\//,
      /\baws-sdk\b/,
      /["']node:https?["']/,
      /["']undici["']/,
      /["']axios["']/,
      /["']node-fetch["']/,
      /["']got["']/,
      // `client.ts` is phase 2 and legitimately speaks HTTP. Reaching it from here would
      // be the seam collapsing, so name it rather than rely on the patterns above.
      /["']\.\/client["']/,
    ]

    const seen = new Set<string>()
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)

      const source = readFileSync(file, "utf8")
      for (const pattern of banned) {
        expect(
          pattern.test(source),
          `${file} matches ${pattern} — normalize() must replay the archive offline`,
        ).toBe(false)
      }

      for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
        visit(resolve(dirname(file), `${match[1]}.ts`))
      }
    }

    visit(join(HERE, "normalize.ts"))

    // Prove the walk actually walked: it must have reached `raw-envelope.ts` and, through
    // it, `json-ids.ts`. A traversal that silently visited one file would pass vacuously.
    expect(seen.size).toBeGreaterThanOrEqual(3)
    expect([...seen].some((f) => f.endsWith("json-ids.ts"))).toBe(true)
  })
})

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * TIME — criteria 4 to 7
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe("relative stream time becomes absolute epoch milliseconds", () => {
  it("puts the first point of a `time: 0` stream exactly on start_date", () => {
    const { trace } = run("run-continuous")
    expect(trace?.points[0].t).toBe(Date.parse("2026-06-01T02:53:48Z"))
  })

  it("advances one second per 1 Hz sample rather than copying the offset through", () => {
    const { trace } = run("run-continuous")
    const base = Date.parse("2026-06-01T02:53:48Z")
    expect(trace?.points.map((p) => p.t)).toEqual([0, 1, 2, 3, 4, 5].map((s) => base + s * 1000))
  })

  it("never leaves a relative value on `t` — no point is a small number", () => {
    const { trace } = run("run-continuous")
    // The failure this catches is `t: 0`, which is 1970 and which a naive zip produces.
    for (const p of trace!.points) expect(p.t).toBeGreaterThan(Date.parse("2020-01-01Z"))
  })
})

describe("startedAtLocal is naive, and startedAt is real UTC", () => {
  it("strips the lying Z and keeps no offset", () => {
    const { activity } = run("run-continuous")
    expect(activity.startedAtLocal).toBe("2026-05-31T19:53:48")
    expect(activity.startedAtLocal).not.toMatch(/Z|[+-]\d{2}:\d{2}$/)
  })

  it("lands a negative-offset evening run on the PREVIOUS local day", () => {
    const { activity } = run("run-continuous")
    // 02:53 UTC on the 1st is 19:53 on the 31st in California. Game-day bucketing reads
    // the local date, so getting this wrong moves the run into the next month.
    expect(activity.startedAt.slice(0, 10)).toBe("2026-06-01")
    expect(activity.startedAtLocal.slice(0, 10)).toBe("2026-05-31")
  })

  /**
   * THE FAILURE THIS FIELD EXISTS TO PREVENT, in one fixture.
   *
   * The run starts 23:30 local on 8 March 2026 — the night US clocks went forward — which
   * is 06:30 UTC on the 9th. Two separate ways to get it wrong:
   *
   *   - bucket by UTC and the run moves to the 9th, a day the operator did not run;
   *   - do arithmetic with the `(GMT-08:00)` label and you land 22:30, because the label is
   *     the zone's STANDARD offset and the run was in DST at -07:00.
   *
   * Stripping the `Z` off a value Strava has already converted is immune to both.
   */
  it("puts a DST-boundary run on the day the operator actually ran", () => {
    const { activity } = run("run-dst-boundary", { externalId: "18736594043" })

    expect(activity.startedAt).toBe("2026-03-09T06:30:00.000Z")
    expect(activity.startedAtLocal).toBe("2026-03-08T23:30:00")
    expect(activity.startedAtLocal.slice(0, 10)).toBe("2026-03-08")
    expect(activity.startedAt.slice(0, 10)).toBe("2026-03-09")

    // The offset actually in force was 7 hours, not the 8 the timezone string advertises.
    const impliedOffsetH =
      (Date.parse(`${activity.startedAtLocal}Z`) - Date.parse(activity.startedAt)) / 3_600_000
    expect(impliedOffsetH).toBe(-7)
    expect(activity.timezone).toBe("America/Los_Angeles")
  })

  it("throws rather than guess when start_date_local is absent", () => {
    expect(() => stripLyingZ(undefined)).toThrow(/start_date_local/)
    expect(() => stripLyingZ("2026-03-08")).toThrow(/naive/)
  })
})

describe("timezone is a bare IANA id", () => {
  it("strips the (GMT±HH:MM) prefix", () => {
    expect(run("run-continuous").activity.timezone).toBe("America/Los_Angeles")
  })

  it("does not store the full prefixed string", () => {
    expect(run("run-continuous").activity.timezone).not.toContain("GMT")
  })

  it("handles a positive offset and a null", () => {
    expect(bareIanaZone("(GMT+01:00) Europe/London")).toBe("Europe/London")
    expect(bareIanaZone(null)).toBeNull()
    expect(bareIanaZone(undefined)).toBeNull()
    expect(run("unknown-sport-type", { externalId: "18736594048" }).activity.timezone).toBeNull()
  })
})

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * TRACE — criteria 8 to 12
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe("simplified is the summary_polyline guard", () => {
  it("is false for a full stream", () => {
    expect(run("run-continuous").trace?.simplified).toBe(false)
  })

  it("is true when the response says it dropped samples", () => {
    // 3 points delivered against an `original_size` of 3600, at resolution "low".
    const { trace } = run("ride-decimated-streams", { externalId: "18736594045" })
    expect(trace?.simplified).toBe(true)
    expect(trace?.pointCount).toBe(3)
  })
})

describe("gaps", () => {
  it("marks a five-minute pause as an index pair", () => {
    const { trace } = run("run-paused", { externalId: "18736594041" })
    expect(trace?.gaps).toEqual([[2, 3]])
  })

  it("emits none for a continuous 1 Hz trace", () => {
    expect(run("run-continuous").trace?.gaps).toEqual([])
  })

  it("uses a threshold that a throttling watch would not trip", () => {
    expect(GAP_THRESHOLD_MS).toBe(30_000)
  })
})

describe("bbox", () => {
  it("is [minLng, minLat, maxLng, maxLat] — lng first, and it is easy to get backwards", () => {
    const { trace } = run("run-continuous")
    expect(trace?.bbox).toEqual([-123.393, -48.87605, -123.39295, -48.876])

    const [minLng, minLat, maxLng, maxLat] = trace!.bbox
    expect(minLng).toBeLessThan(maxLng)
    expect(minLat).toBeLessThan(maxLat)
    for (const p of trace!.points) {
      expect(p.lng).toBeGreaterThanOrEqual(minLng)
      expect(p.lng).toBeLessThanOrEqual(maxLng)
      expect(p.lat).toBeGreaterThanOrEqual(minLat)
      expect(p.lat).toBeLessThanOrEqual(maxLat)
    }
  })
})

describe("altM and accuracyM are never synthesised", () => {
  it("carries altitude when the stream gives it", () => {
    expect(run("run-continuous").trace?.points.map((p) => p.altM)).toEqual([
      3.0, 3.1, 3.2, 3.1, 3.0, 2.9,
    ])
  })

  it("omits the KEY when the altitude stream is absent — never defaults it to 0", () => {
    const { trace } = run("run-no-altitude", { externalId: "18736594042" })
    for (const p of trace!.points) {
      expect(p.altM).toBeUndefined()
      expect("altM" in p).toBe(false)
    }
  })

  it("never sets accuracyM, because Strava's stream carries no accuracy", () => {
    // Absent means unknown. A 0 would read downstream as a perfect fix, which is a claim
    // nobody made.
    for (const p of run("run-continuous").trace!.points) expect("accuracyM" in p).toBe(false)
  })
})

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * IDS, CLOCK AND DETERMINISM — criteria 10 and 13
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe("ids are deterministic", () => {
  /**
   * LOCKED TO LITERALS, not recomputed with the same expression the implementation uses —
   * that would assert only that the code equals itself. `02-data-model.md` §8.3 forbids
   * changing this derivation without a full rebuild, so a change here should require
   * deliberately editing a constant.
   */
  it("computes activityId as sha256(userId:source:externalId)", () => {
    expect(run("run-continuous").activity.activityId).toBe(
      "9fb3a90f666ebe8f2bf666719e6d63d79d541892f35263ca5b105b9ccc1981a6",
    )
  })

  it("computes dedupeKey as the §2.7 composite, cross-source and unprefixed", () => {
    const { activity } = run("run-continuous")
    expect(activity.dedupeKey).toBe(
      "a2c4cbc4068fa3de99b703f8dd8d23ecd416f6af9a4f72ee74c4feef29cc0999",
    )
    expect(activity.dedupeKey).not.toMatch(/^sha256:/)
  })

  it("buckets the composite coarsely enough for two devices to agree on one run", () => {
    // Time to the minute, distance to 50 m, elapsed to 30 s. Asserted through the real
    // formula on a hand-built pair rather than through a fixture, because the point is the
    // bucketing and not this activity.
    const key = (userId: string, startedAtMs: number, distanceM: number, elapsedS: number) =>
      createHash("sha256")
        .update(
          [
            userId,
            Math.floor(startedAtMs / 1000 / 60),
            Math.round(distanceM / 50),
            Math.round(elapsedS / 30),
          ].join("|"),
        )
        .digest("hex")

    const base = Date.parse("2026-06-01T02:53:48Z")

    // The same run as a second source would have recorded it: 5 s later, 10 m longer.
    expect(key("u", base, 3300, 1380)).toBe(key("u", base + 5_000, 3310, 1385))

    /**
     * AND THE HONEST LIMIT, asserted rather than left to be discovered.
     *
     * These are BUCKETS, not tolerances: two recordings that straddle a boundary do NOT
     * collide however close they are. 3310 m and 3330 m are 20 m apart and land in
     * different 50 m buckets, so the same run recorded by two devices can produce two
     * `dedupeKey`s and therefore two activities.
     *
     * That is a real weakness in the §2.7 formula and it is NOT this ticket's to fix — the
     * cross-source case does not exist until the §4 adapters land. Filed as `0169` so it
     * is a known bound rather than a surprise the first time Health Connect arrives.
     */
    expect(key("u", base, 3310, 1380)).not.toBe(key("u", base, 3330, 1380))
  })

  it("returns byte-identical output for the same fixture normalized twice", () => {
    expect(JSON.stringify(run("run-continuous"))).toBe(JSON.stringify(run("run-continuous")))
  })

  it("locks the whole normalized shape", () => {
    expect(run("run-continuous")).toMatchSnapshot()
  })
})

describe("nothing derives from the wall clock", () => {
  it("takes ingestedAt from ref.archivedAt", () => {
    expect(run("run-continuous").activity.ingestedAt).toBe(REF.archivedAt)
  })

  it("takes SourceRef.fetchedAt from ref.archivedAt, not from the queue time", () => {
    const { activity } = run("run-continuous")
    expect(activity.source.fetchedAt).toBe(REF.archivedAt)
    // `enqueuedAt` is the moment the job was queued — BEFORE fetchRaw ran. Using it would
    // understate by however long the queue was backed up.
    expect(activity.source.fetchedAt).not.toBe(job().enqueuedAt)
  })

  it("moves every derived timestamp when only ref.archivedAt moves", () => {
    const later: RawArchiveRef = { ...REF, archivedAt: "2031-01-01T00:00:00.000Z" }
    const out = normalizeStrava(fixture("run-continuous"), later, job())

    expect(out.activity.ingestedAt).toBe("2031-01-01T00:00:00.000Z")
    expect(out.activity.source.fetchedAt).toBe("2031-01-01T00:00:00.000Z")
    // …and nothing about the run itself moved with it. This is the rebuild drill in one
    // assertion: replayed five years later, the activity is the same activity.
    expect(out.activity.startedAt).toBe("2026-06-01T02:53:48.000Z")
    expect(out.activity.activityId).toBe(run("run-continuous").activity.activityId)
    expect(out.trace).toEqual(run("run-continuous").trace)
  })
})

describe("revision comes from the job", () => {
  it("defaults to 1 when the meta does not carry one", () => {
    expect(run("run-continuous").activity.revision).toBe(1)
  })

  it("uses the meta's value on a re-ingest of a source-side edit", () => {
    const meta: StravaIngestMeta = {
      aspectType: "create",
      hasGpsHint: true,
      startedAt: "2026-06-01T02:53:48Z",
      revision: 4,
    }
    expect(run("run-continuous", { command: "reingest", meta }).activity.revision).toBe(4)
  })

  it("ignores a meta that is not an object, rather than throwing", () => {
    expect(run("run-continuous", { meta: null }).activity.revision).toBe(1)
    expect(run("run-continuous", { meta: "nonsense" }).activity.revision).toBe(1)
  })
})

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * KIND MAPPING — §2.6, brought forward from 0037 by operator decision
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe("kind is mapped from sport_type", () => {
  it("reads sport_type and NOT the lossy legacy `type`", () => {
    // The fixture is `type: "Run"`, `sport_type: "TrailRun"` — the exact case where the
    // legacy field is lying by omission.
    const { activity } = run("trailrun-legacy-type-mismatch", { externalId: "18736594044" })
    expect(activity.kind).toBe("run")
    expect(activity.source.sourceTypeRaw).toBe("TrailRun")
  })

  it("maps the running family, walks and hikes distinctly", () => {
    expect(mapSportTypeToKind("Run")).toBe("run")
    expect(mapSportTypeToKind("TrailRun")).toBe("run")
    expect(mapSportTypeToKind("VirtualRun")).toBe("run")
    expect(mapSportTypeToKind("Walk")).toBe("walk")
    expect(mapSportTypeToKind("Hike")).toBe("hike")
  })

  it("maps the strength-shaped types to strength, and Workout to other", () => {
    expect(mapSportTypeToKind("WeightTraining")).toBe("strength")
    expect(mapSportTypeToKind("Crossfit")).toBe("strength")
    expect(mapSportTypeToKind("HighIntensityIntervalTraining")).toBe("strength")
    // Strava's catch-all: 19 modern sport types collapse into it, most not strength at all.
    expect(mapSportTypeToKind("Workout")).toBe("other")
  })

  it("does not crash on a sport type Strava added after this code was written", () => {
    const { activity } = run("unknown-sport-type", { externalId: "18736594048" })
    expect(activity.kind).toBe("other")
    // The verbatim string survives, so the activity can be re-mapped out of the archive
    // later without ever calling Strava again. A new sport type is a backlog ticket.
    expect(activity.source.sourceTypeRaw).toBe("CoastalRowingWithJetpack")
  })

  it("emits a kind, never a skill", () => {
    const source = readFileSync(join(HERE, "normalize.ts"), "utf8")
    for (const skill of ["wayfaring", "vigil", "cartography", "might", "fortitude"]) {
      expect(source.toLowerCase()).not.toContain(skill)
    }
  })

  it("normalizes a VirtualRun to a run with no trace, without a special case", () => {
    // `hasTrace` falls out of the streams being null. If this ever needs a branch on
    // `sport_type`, D-141 has been broken.
    const { activity, trace } = run("treadmill-no-streams", { externalId: "18736594046" })
    expect(activity.kind).toBe("run")
    expect(activity.hasTrace).toBe(false)
    expect(activity.traceRef).toBeNull()
    expect(trace).toBeUndefined()
  })

  it("normalizes a strength-shaped activity without inventing sets", () => {
    const { activity } = run("weight-training", { externalId: "18736594047" })
    expect(activity.kind).toBe("strength")
    // D-060: Strava has no concept of reps. Parsing "Pushups 3x20" out of the title is
    // exactly the heuristic that writes silent wrong data into an append-only ledger.
    expect(activity.sets).toEqual([])
    expect(activity.name).toBe("Pushups 3x20")
  })
})

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * SCALARS, AND THE FIXTURES THEMSELVES
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe("scalar fields", () => {
  it("carries the source's own distance, times and elevation", () => {
    const { activity } = run("run-continuous")
    expect(activity.elapsedS).toBe(1380)
    expect(activity.movingS).toBe(1200)
    expect(activity.distanceM).toBe(3310.4)
    expect(activity.elevationGainM).toBe(12.2)
    expect(activity.name).toBe("Evening Run")
  })

  it("omits optional scalars the source did not send", () => {
    const { activity } = run("run-no-altitude", { externalId: "18736594042" })
    expect(activity.elevationGainM).toBeUndefined()
  })

  it("takes externalId from the job verbatim, never from the parsed body", () => {
    // The job is what the queue keyed on. If the two could differ, one run would become
    // two activities on a map that never re-fogs.
    expect(run("run-continuous", { externalId: "18736594040" }).activity.source.externalId).toBe(
      "18736594040",
    )
  })

  it("throws a named error rather than producing a half-activity", () => {
    const notAnEnvelope = Buffer.from(JSON.stringify({ id: 1 }))
    expect(() => normalizeStrava(notAnEnvelope, REF, job())).toThrow(/raw envelope/)

    const noStartDate = Buffer.from(
      JSON.stringify({ schemaVersion: 1, source: "strava", detail: { elapsed_time: 1 }, streams: null }),
    )
    expect(() => normalizeStrava(noStartDate, REF, job())).toThrow(/start_date/)
  })
})

/**
 * THE FIXTURE GUARD, and it is an ALLOWLIST on purpose.
 *
 * This repository is public and `github.com/Oofles/lost-soles` is cloneable forever. The
 * obvious guard — "no coordinate near where the operator runs" — cannot be written without
 * committing where the operator runs, which is the leak, written into the repo to prevent
 * the leak. So the assertion is inverted: every fixture coordinate must be within a few
 * kilometres of Point Nemo, the point on Earth farthest from any land.
 *
 * A hand-added fixture carrying a real track fails this the moment it lands.
 */
describe("no fixture carries a real location", () => {
  const NEMO = { lat: -48.876, lng: -123.393 }
  const RADIUS_DEG = 0.05 // ~5.5 km of latitude. Generous for a synthetic track; nowhere.

  it("keeps every committed latlng point in the South Pacific", () => {
    const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".json"))
    expect(files.length).toBeGreaterThan(0)

    let checked = 0
    for (const file of files) {
      const parsed = JSON.parse(readFileSync(join(FIXTURES, file), "utf8"))
      const points: unknown = parsed?.streams?.latlng?.data
      if (!Array.isArray(points)) continue

      for (const [lat, lng] of points as Array<[number, number]>) {
        expect(Math.abs(lat - NEMO.lat), `${file} carries a latitude outside the fixture box`)
          .toBeLessThan(RADIUS_DEG)
        expect(Math.abs(lng - NEMO.lng), `${file} carries a longitude outside the fixture box`)
          .toBeLessThan(RADIUS_DEG)
        checked++
      }
    }

    // The guard must have had something to check. A fixture directory that stopped being
    // read would otherwise pass this test silently.
    expect(checked).toBeGreaterThan(10)
  })
})
