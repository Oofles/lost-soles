import { describe, expect, it } from "vitest"

import { computeActivityId } from "@/src/domain/activity-id"
import type { RawArchiveRef } from "@/src/domain/activity"

import { assertNormalizeIsPure } from "../normalize-purity"
import { AUTHENTICATED_SUB_HEADER } from "../principal"
import type { InboundRequest, IngestJob } from "../types"
import { localWallClock, manualAdapter, manualIngestKey, MANUAL_SCHEMA_HINT } from "./adapter"

/**
 * Ticket 0069. The adapter's four phases, from a clean `WorkoutEntry` to an `Activity`.
 * End to end through `processActivity` is `lib/log/log-workout.test.ts`.
 */

const USER = "u-manual"
const ENTRY = {
  exerciseId: "pushup",
  sets: [{ reps: 30 }],
  occurredAt: "2026-10-02T13:15:00.000Z",
  idempotencyKey: "4d6c2f1e-key",
  timezone: "America/Denver",
}

const request = (body: unknown = ENTRY, sub: string | null = USER): InboundRequest => ({
  source: "manual",
  method: "POST",
  headers: sub === null ? {} : { [AUTHENTICATED_SUB_HEADER]: sub },
  query: {},
  rawBody: Buffer.from(JSON.stringify(body), "utf8"),
})

async function jobFor(body: unknown = ENTRY): Promise<IngestJob> {
  const ack = await manualAdapter.accept(request(body))
  expect(ack.status).toBe(202)
  const [command] = ack.commands
  if (command?.kind !== "ingest") throw new Error("expected one ingest command")
  return command.job
}

const REF: RawArchiveRef = {
  bucket: "b",
  key: "raw/u-manual/manual/4d6c2f1e-key/abc.json",
  contentType: "application/json",
  bytes: 120,
  sha256: "abc",
  archivedAt: "2026-10-02T13:15:02.000Z",
}

describe("accept — phase 1", () => {
  it("builds exactly one ingest job, keyed on the user and the client's idempotency key", async () => {
    const job = await jobFor()
    expect(job).toMatchObject({
      ingestKey: manualIngestKey(USER, ENTRY.idempotencyKey),
      userId: USER,
      source: "manual",
      externalId: ENTRY.idempotencyKey,
      command: "ingest",
      startedAt: ENTRY.occurredAt,
    })
  })

  it("the same key from the same user is the same job; from another user it is not", async () => {
    expect(manualIngestKey(USER, "k")).toBe(manualIngestKey(USER, "k"))
    expect(manualIngestKey(USER, "k")).not.toBe(manualIngestKey("someone-else", "k"))
  })

  it("refuses with no command when the principal is missing — it must never become a write", async () => {
    expect(await manualAdapter.accept(request(ENTRY, null))).toMatchObject({ status: 401, commands: [] })
  })

  it("refuses with no command when the body is not an entry", async () => {
    expect(await manualAdapter.accept(request({ sets: [] }))).toMatchObject({ status: 400, commands: [] })
  })
})

describe("fetchRaw — phase 2", () => {
  it("returns the accepted bytes verbatim, with no network, under its own schema hint", async () => {
    const job = await jobFor()
    const raw = await manualAdapter.fetchRaw(job, null)
    expect(raw.body.equals(request().rawBody)).toBe(true)
    expect(raw).toMatchObject({ contentType: "application/json", ext: "json", schemaHint: MANUAL_SCHEMA_HINT })
  })
})

describe("normalize — phase 3", () => {
  it("is pure and deterministic", async () => {
    const job = await jobFor()
    assertNormalizeIsPure(manualAdapter, { raw: request().rawBody, ref: REF, job })
  })

  it("has no trace: hasTrace false, traceRef null, no trace object — and no flag saying so (I-27)", async () => {
    const job = await jobFor()
    const ingest = manualAdapter.normalize(request().rawBody, REF, job)
    expect(ingest.trace).toBeUndefined()
    expect(ingest.activity).toMatchObject({ hasTrace: false, traceRef: null })
    expect(Object.keys(ingest.activity)).not.toContain("grantsDiscovery")
  })

  it("is otherwise the canonical Activity row, from the manual source", async () => {
    const job = await jobFor()
    const { activity } = manualAdapter.normalize(request().rawBody, REF, job)
    expect(activity).toEqual({
      activityId: computeActivityId(USER, "manual", ENTRY.idempotencyKey),
      userId: USER,
      kind: "strength",
      startedAt: ENTRY.occurredAt,
      startedAtLocal: "2026-10-02T07:15:00",
      timezone: "America/Denver",
      elapsedS: 0,
      source: { source: "manual", externalId: ENTRY.idempotencyKey, sourceTypeRaw: "pushup", fetchedAt: REF.archivedAt },
      raw: REF,
      traceRef: null,
      hasTrace: false,
      sets: [{ exercise: "pushup", reps: 30 }],
      dedupeKey: expect.any(String),
      ingestedAt: REF.archivedAt,
      revision: 1,
    })
  })

  it("keeps a back-dated occurredAt as startedAt — scoring reads it, never the clock", async () => {
    const backdated = { ...ENTRY, occurredAt: "2026-03-01T06:00:00.000Z" }
    const job = await jobFor(backdated)
    const raw = Buffer.from(JSON.stringify(backdated))
    expect(manualAdapter.normalize(raw, REF, job).activity.startedAt).toBe("2026-03-01T06:00:00.000Z")
  })

  it("an archive written before D-286 carries no kind, and is the strength log it was", async () => {
    const job = await jobFor(ENTRY)
    expect(manualAdapter.normalize(Buffer.from(JSON.stringify(ENTRY)), REF, job).activity.kind).toBe("strength")
  })

  it("a distance entry is a traceless activity of its stamped kind, with the sets' distance and time (D-286)", async () => {
    const distance = { ...ENTRY, exerciseId: "a-distance", kind: "run", sets: [{ distanceM: 5000, durationS: 1800 }] }
    const job = await jobFor(distance)
    const { activity } = manualAdapter.normalize(Buffer.from(JSON.stringify(distance)), REF, job)
    expect(activity).toMatchObject({ kind: "run", distanceM: 5000, elapsedS: 1800, hasTrace: false, traceRef: null })
  })

  it("a count carries no distance at all, so the row shape for strength is unchanged", async () => {
    const job = await jobFor(ENTRY)
    expect("distanceM" in manualAdapter.normalize(Buffer.from(JSON.stringify(ENTRY)), REF, job).activity).toBe(false)
  })

  it("refuses an archived kind that is not an ActivityKind", async () => {
    const odd = { ...ENTRY, kind: "swim" }
    expect((await manualAdapter.accept(request(odd))).status).toBe(400)
  })

  it("counts a plank's seconds as elapsed time", async () => {
    const plank = { ...ENTRY, exerciseId: "plank", sets: [{ durationS: 60 }, { durationS: 45 }] }
    const job = await jobFor(plank)
    expect(manualAdapter.normalize(Buffer.from(JSON.stringify(plank)), REF, job).activity.elapsedS).toBe(105)
  })
})

describe("listSince — phase 4", () => {
  it("yields nothing: there is no remote history to reconcile", async () => {
    const seen: IngestJob[] = []
    for await (const job of manualAdapter.listSince(USER, "2026-01-01T00:00:00Z", null)) seen.push(job)
    expect(seen).toEqual([])
  })
})

describe("localWallClock", () => {
  it("renders the zone's wall clock, across a DST boundary, and UTC with no zone", () => {
    expect(localWallClock("2026-01-15T03:30:00Z", "America/Denver")).toBe("2026-01-14T20:30:00")
    expect(localWallClock("2026-07-15T03:30:00Z", "America/Denver")).toBe("2026-07-14T21:30:00")
    expect(localWallClock("2026-07-15T00:00:00Z", null)).toBe("2026-07-15T00:00:00")
  })
})
