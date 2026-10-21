import { createHash } from "node:crypto"

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"
import { afterEach, describe, expect, it, vi } from "vitest"

import { getAdapter } from "@/src/adapters/registry"
import type { SourceAdapter } from "@/src/adapters/types"
import type { SourceId } from "@/src/domain/activity"
import { computeActivityId } from "@/src/domain/activity-id"

import {
  classifyRawKey,
  enumerationFromListing,
  normalizeAll,
  runDrillFrontHalf,
  sortForFold,
  type DrillS3,
  type RunDrillOptions,
} from "./rebuild-drill"
import { retractionRecordKey } from "./retraction-record"

/**
 * Ticket `0102`. The drill's front half against an in-memory bucket and the REAL manual adapter —
 * the drill's whole claim is that the shipped normalizer replays the archive, so a fake normalizer
 * would prove only the plumbing. Fake adapters appear only where the point is a failing one.
 */

const UID = "u-drill"
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex")

const entry = (externalId: string, occurredAt: string) =>
  Buffer.from(
    JSON.stringify({
      exerciseId: "pushup",
      sets: [{ reps: 20 }],
      occurredAt,
      idempotencyKey: `${externalId}-key`,
      timezone: "America/Denver",
    }),
  )

interface Obj {
  key: string
  body: Buffer
  lastModified: Date
}

const payload = (externalId: string, body: Buffer, at = "2026-10-01T00:00:00Z", source = "manual"): Obj => ({
  key: `raw/${UID}/${source}/${externalId}/${sha(body)}.json`,
  body,
  lastModified: new Date(at),
})

/** A bucket: `ListObjectsV2` pages of two, so pagination is exercised, and `GetObject`. */
function bucket(objects: Obj[]): DrillS3 & { gets: string[] } {
  const gets: string[] = []
  const s3 = {
    gets,
    async send(command: unknown) {
      if (command instanceof ListObjectsV2Command) {
        const prefix = command.input.Prefix ?? ""
        const all = objects.filter((o) => o.key.startsWith(prefix))
        const start = Number(command.input.ContinuationToken ?? 0)
        const page = all.slice(start, start + 2)
        const more = start + 2 < all.length
        return {
          Contents: page.map((o) => ({ Key: o.key, LastModified: o.lastModified })),
          IsTruncated: more,
          NextContinuationToken: more ? String(start + 2) : undefined,
        }
      }
      if (command instanceof GetObjectCommand) {
        const key = command.input.Key!
        gets.push(key)
        const o = objects.find((x) => x.key === key)
        if (!o) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" })
        return { Body: { transformToByteArray: async () => new Uint8Array(o.body) }, ContentType: "application/json" }
      }
      throw new Error(`unexpected command ${String(command)}`)
    },
  }
  return s3 as unknown as DrillS3 & { gets: string[] }
}

const SNAPSHOT: Obj = {
  key: `snapshots/skillstate/${UID}/2026-10-18T00:00:00.000Z-7.json`,
  body: Buffer.from(JSON.stringify({ userId: UID, skills: [] })),
  lastModified: new Date("2026-10-18T00:00:00Z"),
}
const MANIFEST: Obj = {
  key: `users/${UID}/manifest.json`,
  body: Buffer.from(JSON.stringify({ generation: 7, cellCount: 42 })),
  lastModified: new Date("2026-10-18T00:00:00Z"),
}

const options = (s3: DrillS3, over: Partial<RunDrillOptions> = {}): RunDrillOptions => ({
  phase: "normalize",
  userId: UID,
  dryRun: true,
  bucket: "b",
  s3,
  rulesFiles: ["rules/xp-rules-v1.yaml", "rules/xp-rules-v1.json"],
  registeredSources: ["manual", "gpslogger"],
  adapterFor: getAdapter,
  saveSnapshot: () => "/local/snapshot.json",
  ...over,
})

afterEach(() => vi.restoreAllMocks())

describe("classifyRawKey — step 1 reads the key, and not every key is a payload", () => {
  const h = "a".repeat(64)
  it("names a payload's source, externalId, digest and extension from the path", () => {
    expect(classifyRawKey(`raw/${UID}/manual/x1/${h}.json`, UID)).toMatchObject({
      kind: "payload",
      source: "manual",
      externalId: "x1",
      sha256: h,
      ext: "json",
    })
  })
  it("a kind override has a payload's depth and is still not a payload (D-284)", () => {
    expect(classifyRawKey(`raw/${UID}/manual/x1.kind-override/20261007T1-ab.json`, UID)).toMatchObject({
      kind: "kind-override",
      externalId: "x1",
      id: "20261007T1-ab",
    })
  })
  it("a duplicate-of pointer is a correction, not a run (D-263)", () => {
    expect(classifyRawKey(`raw/${UID}/manual/x1.duplicate-of.json`, UID)).toMatchObject({
      kind: "duplicate-pointer",
      externalId: "x1",
    })
  })
  it("a D-355 retraction record is a correction, not a run (0301) — the key the live retract path writes", () => {
    const key = retractionRecordKey({ userId: UID, source: "manual", externalId: "x1" })
    expect(key).toBe(`raw/${UID}/manual/x1.retracted.json`)
    expect(classifyRawKey(key, UID)).toMatchObject({ kind: "retraction", source: "manual", externalId: "x1" })
    expect(classifyRawKey(`raw/${UID}/manual/.retracted.json`, UID).kind).toBe("unrecognised")
  })
  it("anything else is unrecognised and kept away from normalize()", () => {
    for (const key of [`raw/${UID}/manual/x1/notahash.json`, `raw/${UID}/manual/x1/${h}.json/extra`, `raw/other/manual/x1/${h}.json`]) {
      expect(classifyRawKey(key, UID).kind).toBe("unrecognised")
    }
  })
})

describe("enumerate phase", () => {
  it("counts every object and derives the SourceId set from key paths alone — DynamoDB stubbed to throw", async () => {
    const ddb = vi.spyOn(DynamoDBClient.prototype, "send").mockImplementation(() => {
      throw new Error("the drill's step 1 must not touch DynamoDB")
    })
    const h = "b".repeat(64)
    const s3 = bucket([
      payload("m1", entry("m1", "2026-09-01T10:00:00Z")),
      { key: `raw/${UID}/gpslogger/123/${h}.json`, body: Buffer.from("{}"), lastModified: new Date() },
      { key: `raw/${UID}/manual/m1.kind-override/2026-a.json`, body: Buffer.from("{}"), lastModified: new Date() },
      { key: `raw/${UID}/manual/m9.duplicate-of.json`, body: Buffer.from("{}"), lastModified: new Date() },
      SNAPSHOT,
      MANIFEST,
    ])
    const { summary, sorted } = await runDrillFrontHalf(options(s3, { phase: "enumerate", expectObjects: 4 }))

    expect(ddb).not.toHaveBeenCalled()
    expect(summary.refused).toBe(false)
    expect(summary.objectCount).toBe(4)
    expect(summary.payloadCount).toBe(2)
    expect(summary.kindOverrideObjectCount).toBe(1)
    expect(summary.duplicatePointerCount).toBe(1)
    expect(summary.sourceIds).toEqual(["gpslogger", "manual"])
    expect(summary.step0).toMatchObject({ generation: 7, cellCount: 42, snapshotKey: SNAPSHOT.key })
    expect(summary.normalizeFailures).toBeNull()
    expect(sorted).toEqual([])
    // Nothing under raw/ was read: enumeration is a listing, not a download.
    expect(s3.gets.filter((k) => k.startsWith("raw/"))).toEqual([])
  })

  it("0301: carries each retraction record to the back half by activityId, and never normalizes it", async () => {
    const record = retractionRecordKey({ userId: UID, source: "manual", externalId: "m1" })
    const s3 = bucket([
      payload("m1", entry("m1", "2026-09-01T10:00:00Z")),
      { key: record, body: Buffer.from("{}"), lastModified: new Date() },
      SNAPSHOT,
      MANIFEST,
    ])
    const front = await runDrillFrontHalf(options(s3, { expectObjects: 2 }))
    expect(front.summary.refused).toBe(false)
    expect(front.summary.retractionCount).toBe(1)
    expect(front.summary.payloadCount).toBe(1)
    expect(front.summary.unrecognisedKeys).toEqual([])
    expect(front.summary.normalizeFailures).toBe(0)
    expect(front.retractions).toEqual(new Map([[computeActivityId(UID, "manual", "m1"), record]]))
    expect(s3.gets).not.toContain(record)
  })
})

describe("preconditions — the script refuses, naming which", () => {
  const good = () => [payload("m1", entry("m1", "2026-09-01T10:00:00Z")), SNAPSHOT, MANIFEST]

  it.each([
    [1, "count differs from the last known figure", good(), { expectObjects: 99 }],
    [1, "raw/ is empty", [SNAPSHOT, MANIFEST], {}],
    [2, "no rules YAML in git", good(), { rulesFiles: ["rules/xp-rules-v1.json"] }],
    [3, "a source with no adapter", [...good(), payload("z", Buffer.from("z"), undefined, "polar")], {}],
    [4, "no snapshot", good().filter((o) => o !== SNAPSHOT), {}],
  ] as const)("precondition %i: %s", async (n, _why, objects, over) => {
    const { summary } = await runDrillFrontHalf(options(bucket([...objects]), over))
    expect(summary.refused).toBe(true)
    expect(summary.preconditions.filter((p) => !p.ok).map((p) => p.n)).toEqual([n])
    expect(summary.step0).toBeNull()
    expect(summary.activityCount).toBeNull()
  })
})

describe("step 2 — verify, normalize purely, and fail an object rather than the run", () => {
  it("a sha256 mismatch fails that object, records its key, and the run goes on", async () => {
    const good = payload("m1", entry("m1", "2026-09-01T10:00:00Z"))
    const bad = { ...payload("m2", entry("m2", "2026-09-02T10:00:00Z")), body: entry("m2", "2026-09-03T10:00:00Z") }
    const logged: unknown[] = []
    const { summary } = await runDrillFrontHalf(
      options(bucket([good, bad, SNAPSHOT, MANIFEST]), { onFailure: (f) => logged.push(f) }),
    )
    expect(summary.normalizeFailures).toBe(1)
    expect(summary.failures![0]).toMatchObject({ key: bad.key, source: "manual" })
    expect(summary.failures![0]!.error).toMatch(/sha256 mismatch/)
    expect(logged).toEqual(summary.failures)
    expect(summary.activityCount).toBe(1)
  })

  it("normalize() runs with fetch and Date.now trapped — the real adapter passes, an impure one fails its object", async () => {
    const seen: string[] = []
    const probe: SourceAdapter = {
      ...getAdapter("manual"),
      normalize(raw, ref, job) {
        for (const [name, call] of [
          ["fetch", () => fetch("https://example.invalid")],
          ["Date.now", () => Date.now()],
        ] as const) {
          try {
            void call()
          } catch {
            seen.push(name)
          }
        }
        return getAdapter("manual").normalize(raw, ref, job)
      },
    }
    const impure: SourceAdapter = {
      ...getAdapter("manual"),
      normalize(raw, ref, job) {
        const out = getAdapter("manual").normalize(raw, ref, job)
        return { ...out, activity: { ...out.activity, ingestedAt: new Date(Date.now()).toISOString() } }
      },
    }
    const real = payload("m1", entry("m1", "2026-09-01T10:00:00Z"))
    const probed = payload("p1", entry("p1", "2026-09-02T10:00:00Z"), undefined, "probe")
    const dirty = payload("d1", entry("d1", "2026-09-03T10:00:00Z"), undefined, "dirty")
    const adapters: Record<string, SourceAdapter> = { manual: getAdapter("manual"), probe, dirty: impure }

    const { summary, sorted } = await runDrillFrontHalf(
      options(bucket([real, probed, dirty, SNAPSHOT, MANIFEST]), {
        registeredSources: ["manual", "probe", "dirty"],
        adapterFor: (s: SourceId) => adapters[s]!,
      }),
    )
    // Two calls per object (assertNormalizeIsPure re-runs to prove determinism), each one trapped.
    expect(seen).toEqual(["fetch", "Date.now", "fetch", "Date.now"])
    expect(summary.failures!.map((f) => f.key)).toEqual([dirty.key])
    expect(summary.failures![0]!.error).toMatch(/not pure/)
    expect(sorted.map((e) => e.activity.source.externalId)).toEqual(["m1", "p1"])
  })

  it("rebuilds ref and job from the key: the clock is the object's LastModified (D-196)", async () => {
    const p = payload("m1", entry("m1", "2026-09-01T10:00:00Z"), "2026-09-05T12:00:00Z")
    const { sorted } = await runDrillFrontHalf(options(bucket([p, SNAPSHOT, MANIFEST])))
    expect(sorted[0]!.ref).toMatchObject({ key: p.key, sha256: sha(p.body), bytes: p.body.byteLength, archivedAt: "2026-09-05T12:00:00.000Z" })
    expect(sorted[0]!.activity.ingestedAt).toBe("2026-09-05T12:00:00.000Z")
    expect(sorted[0]!.activity.activityId).toBe(computeActivityId(UID, "manual", "m1"))
  })

  it("two payloads for one activity: both verified, only the newest emitted", async () => {
    const older = payload("m1", entry("m1", "2026-09-01T10:00:00Z"), "2026-09-01T12:00:00Z")
    const newer = payload("m1", entry("m1", "2026-09-01T10:00:01Z"), "2026-10-01T12:00:00Z")
    const { summary, sorted } = await runDrillFrontHalf(options(bucket([older, newer, SNAPSHOT, MANIFEST])))
    expect(summary.payloadCount).toBe(2)
    expect(summary.supersededObjects).toBe(1)
    expect(summary.activityCount).toBe(1)
    expect(sorted[0]!.ref.key).toBe(newer.key)
    expect(sorted[0]!.activity.startedAt).toBe("2026-09-01T10:00:01Z")
  })

  it("the newest kind override is applied after normalize() (D-284)", async () => {
    const p = payload("m1", entry("m1", "2026-09-01T10:00:00Z"))
    const ov = (id: string, kind: string): Obj => ({
      key: `raw/${UID}/manual/m1.kind-override/${id}.json`,
      body: Buffer.from(JSON.stringify({ id, kind, setBy: "op", setAt: "2026-10-07T00:00:00Z" })),
      lastModified: new Date(),
    })
    const { summary, sorted } = await runDrillFrontHalf(
      options(bucket([p, ov("20261007T1-a", "run"), ov("20261007T2-b", "walk"), SNAPSHOT, MANIFEST])),
    )
    expect(summary.kindOverridesApplied).toBe(1)
    expect(sorted[0]!.activity.kind).toBe("walk")
    expect(sorted[0]!.activity.derivedKind).toBe("strength")
    expect(sorted[0]!.activity.kindOverride?.key).toMatch(/20261007T2-b\.json$/)
  })
})

describe("step 3 — sort is stable under shuffled input", () => {
  it("identical input in any order produces a byte-identical id list, ties broken by activityId", async () => {
    const objects = [
      payload("a", entry("a", "2026-09-02T10:00:00Z")),
      payload("b", entry("b", "2026-09-01T10:00:00Z")),
      payload("c", entry("c", "2026-09-01T10:00:00Z")), // ties with b
      payload("d", entry("d", "2026-09-01T10:00:00Z")), // and d
      payload("e", entry("e", "2026-08-01T10:00:00Z")),
    ]
    const listing = objects.map((o) => ({ key: o.key, lastModified: o.lastModified }))
    const s3 = bucket(objects)
    const runs: string[] = []
    let seed = 7
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    for (let i = 0; i < 6; i++) {
      const shuffled = [...listing].sort(() => rand() - 0.5)
      const phase = await normalizeAll(enumerationFromListing(UID, shuffled), {
        s3,
        bucket: "b",
        adapterFor: getAdapter,
        concurrency: 1 + (i % 3),
      })
      const entries = [...phase.entries].sort(() => rand() - 0.5)
      runs.push(JSON.stringify(sortForFold(entries).map((e) => e.activity.activityId)))
    }
    expect(new Set(runs).size).toBe(1)

    const ids = JSON.parse(runs[0]!) as string[]
    const id = (x: string) => computeActivityId(UID, "manual", x)
    const tied = [id("b"), id("c"), id("d")].sort()
    expect(ids).toEqual([id("e"), ...tied, id("a")])
  })
})
