import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { getAdapter, registeredSources } from "../../../src/adapters/registry"
import type { SourceAdapter } from "../../../src/adapters/types"
import type { NormalizedIngest, SourceId } from "../../../src/domain/activity"
import { computeActivityId } from "../../../src/domain/activity-id"
import type { DiscoveryAward } from "../../../src/domain/discovery"
import { classifyRawKey } from "../../../src/pipeline/rebuild-drill"
import { CHECK_REASONS, exitCodeForCheck } from "../../../src/pipeline/rebuild-drill-back"

import {
  CORRUPT_FIXTURE_DIR,
  FIXTURE_DIR,
  ROOT,
  loadFixture,
  readExpected,
  runDrillCi,
  type DrillCiResult,
} from "./drill-ci"

/**
 * Ticket `0104`. `npm run drill:ci`'s fixture, its branches, and the proof that it bites. Every
 * run here is the real front and back half (`runDrillFrontHalf`, `runDrillBackHalf`) over the
 * committed bytes; only the bucket and the target are in memory.
 */

const fixture = loadFixture(FIXTURE_DIR)
const UID = fixture.userId
const id = (source: SourceId, externalId: string) => computeActivityId(UID, source, externalId)
const expected = readExpected()

const run = (over: Parameters<typeof runDrillCi>[0] = { expected }) => runDrillCi({ ...over })

const t3 = (r: DrillCiResult, activityId: string) => r.store.activities.get(activityId) as Record<string, unknown> | undefined
const award = (r: DrillCiResult, activityId: string) => t3(r, activityId)?.award as DiscoveryAward | undefined
const ledgerOf = (r: DrillCiResult, activityId: string) => [...r.store.ledger.values()].filter((e) => e.activityId === activityId)
const cellItems = (r: DrillCiResult) => [...r.store.cellItems.values()].filter((i) => String(i.pk).includes("#C#"))

/** The shipped registry, with one adapter's `normalize()` output altered. Purity still holds. */
function mutated(source: SourceId, mutate: (out: NormalizedIngest) => NormalizedIngest) {
  return (s: SourceId): SourceAdapter => {
    const base = getAdapter(s)
    if (s !== source) return base
    return { ...base, normalize: (raw, ref, job) => mutate(base.normalize(raw, ref, job)) }
  }
}

describe("drill:ci — the rebuild drill, steps 0–8, over the committed fixture", () => {
  it("passes all six step-8 assertions and every expectation, well inside 60 s", async () => {
    const r = await run()
    expect(r.failed).toBeNull()
    expect(r.back!.step8.map((c) => [c.n, c.status])).toEqual([1, 2, 3, 4, 5, 6].map((n) => [n, "pass"]))
    expect(r.expectations.every((e) => e.ok)).toBe(true)
    expect(r.back!.generation).toBe(expected.step0.generation + 1)
    expect(r.wallClockMs).toBeLessThan(60_000)
  })

  it("is ~20 objects, carries a superseded re-fetch and a kind override, and is the same on a second run", async () => {
    expect(fixture.objects.length).toBeGreaterThanOrEqual(15)
    expect(fixture.objects.length).toBeLessThanOrEqual(25)
    const [a, b] = [await run(), await run()]
    expect(a.front.summary.supersededObjects).toBe(1)
    expect(a.front.summary.kindOverridesApplied).toBe(1)
    expect(t3(a, id("strava", "17000000007"))?.kind).toBe("run")
    expect([...b.store.ledger.values()]).toEqual([...a.store.ledger.values()])
    expect([...b.store.cellItems.values()]).toEqual([...a.store.cellItems.values()])
  })
})

describe("fixture coverage — every registered SourceId has a raw object", () => {
  it("enumerates the adapter registry and finds a payload for each source", () => {
    const covered = new Set(
      fixture.objects.flatMap((o) => {
        const c = classifyRawKey(o.key, UID)
        return c.kind === "payload" ? [c.source] : []
      }),
    )
    const missing = registeredSources().filter((s) => !covered.has(s))
    expect(missing, `add a fixture object under tools/drill/__fixtures__/ci for: ${missing.join(", ")}`).toEqual([])
  })

  it("normalizes at least one object of every source in the drill itself", async () => {
    const r = await run()
    expect(r.uncoveredSources).toEqual([])
    for (const s of registeredSources()) expect(r.normalizedBySource[s], s).toBeGreaterThan(0)
  })
})

describe("the five shapes that break folds", () => {
  it("no trace (D-132, the Vigil path): full XP, zero discovery credit, nothing revealed", async () => {
    const r = await run()
    for (const activityId of [id("strava", "17000000006"), id("manual", "fx0104-treadmill")]) {
      const row = t3(r, activityId)!
      expect(row.hasTrace).toBe(false)
      expect(row.traceRef).toBeNull()
      expect(row.cellsRef).toBeNull()
      expect(r.store.objects.has(`users/${UID}/cells/${activityId}.bin`)).toBe(false)
      const rows = ledgerOf(r, activityId)
      const vigil = rows.find((e) => e.skillId === "vigil")!
      // Full activity XP — 100/km, the same as Wayfaring, not half (D-132).
      expect(vigil.xpAwarded).toBe(Math.round(vigil.units * 100))
      expect(rows.some((e) => e.skillId === "cartography" || e.reason.endsWith("_ground"))).toBe(false)
    }
  })

  it("overlapping cells: visitCount and discoveryCount count a cooled visit, and recent ground pays half", async () => {
    const r = await run()
    const first = id("strava", "17000000001")
    const second = id("strava", "17000000002")
    // Route A ∩ A2 was run three times: new (1), cooled two weeks later (2), re-armed (3). Three
    // visits, two of which earned credit. Route A alone was run twice, both credited.
    const shared = cellItems(r).filter((c) => c.firstRunId === first && c.visitCount === 3)
    expect(shared.length).toBe(award(r, second)!.cooledCellCount)
    for (const c of shared) expect(c.discoveryCount).toBe(2)
    const a = award(r, second)!
    expect(a.newCellCount).toBeGreaterThan(0)
    expect(a.cooledCellCount).toBeGreaterThan(0)
    const recent = ledgerOf(r, second).find((e) => e.reason === "recent_ground")!
    const fresh = ledgerOf(r, second).find((e) => e.reason === "new_ground")!
    // Half rate on recent ground (`groundMultipliers.recent: 0.5`), full on new.
    expect(recent.xpAwarded).toBe(Math.round(recent.units * 100 * 0.5))
    expect(fresh.xpAwarded).toBe(Math.round(fresh.units * 100))
  })

  it("the same ground more than six months later: re-armed, credited again", async () => {
    const r = await run()
    const rearm = id("strava", "17000000003")
    const a = award(r, rearm)!
    expect(a.rearmedCellCount).toBeGreaterThan(0)
    expect(a.newCellCount).toBe(0)
    expect(a.cooledCellCount).toBe(0)
    const rows = ledgerOf(r, rearm)
    expect(rows.map((e) => e.reason)).toEqual(expect.arrayContaining(["rearmed_ground", "cells_rearmed"]))
    const again = cellItems(r).filter((c) => c.lastRunId === rearm)
    expect(again.length).toBe(a.rearmedCellCount)
    for (const c of again) expect(c.discoveryCount).toBe(2)
  })

  it("an identical dedupeKey: the D-263 loser is dropped and check 2 subtracts it", async () => {
    const r = await run()
    const winner = id("strava", "17000000004")
    const loser = id("strava", "17000000005")
    const normalized = new Map(r.front.sorted.map((e) => [e.activity.activityId, e.activity] as const))
    expect(normalized.get(loser)!.dedupeKey).toBe(normalized.get(winner)!.dedupeKey)
    expect(r.front.duplicatePointers.has(loser)).toBe(true)
    expect(t3(r, loser)).toBeUndefined()
    expect(ledgerOf(r, loser)).toEqual([])
    expect(t3(r, winner)).toBeDefined()
    const check2 = r.back!.step8.find((c) => c.n === 2)!
    expect(check2.status).toBe("pass")
    expect(check2.detail).toContain("− 1 duplicate pointers")
    expect(r.back!.duplicatesDropped).toBe(1)
  })

  it("a corrupt object: a logged, counted normalize failure, the run goes on, and assertion 1 fails", async () => {
    const logged: string[] = []
    const r = await run({ expected, fixtureDirs: [FIXTURE_DIR, CORRUPT_FIXTURE_DIR], onFailure: (f) => logged.push(f.key) })
    const corrupt = loadFixture(CORRUPT_FIXTURE_DIR).objects[0]!.key
    expect(logged).toEqual([corrupt])
    expect(r.front.summary.normalizeFailures).toBe(1)
    expect(r.failuresBySource).toEqual({ strava: 1 })
    // Not an abort: steps 4–8 ran over everything else, and the delivery layer was published.
    expect(r.back!.step8).toHaveLength(6)
    expect(r.back!.generation).toBe(expected.step0.generation + 1)
    expect(r.back!.activitiesWritten).toBe(expected.activityCount)
    expect(r.failed).toMatchObject({ reason: CHECK_REASONS[1], exitCode: exitCodeForCheck(1) })
  })
})

describe("the drill catches breakage — mutation tests", () => {
  it("Strava's normalize() losing half of every trace fails assertion 3, before anything is published", async () => {
    const r = await run({
      expected,
      adapterFor: mutated("strava", (out) =>
        out.trace
          ? { ...out, trace: { ...out.trace, points: out.trace.points.slice(0, out.trace.points.length >> 1), pointCount: out.trace.points.length >> 1 } }
          : out,
      ),
    })
    expect(r.failed).toMatchObject({ reason: CHECK_REASONS[3], exitCode: exitCodeForCheck(3) })
    expect(r.store.objects.has(`users/${UID}/manifest.json`)).toBe(false)
  })

  it("Strava's normalize() halving distanceM is floored past check 4 and fails assertion 6", async () => {
    const r = await run({
      expected,
      adapterFor: mutated("strava", (out) => ({
        ...out,
        activity: { ...out.activity, distanceM: out.activity.distanceM === undefined ? undefined : out.activity.distanceM / 2 },
      })),
    })
    // The D-135 floors hold displayed XP at the snapshot, which is check 4's job: it passes.
    expect(r.back!.step8.find((c) => c.n === 4)!.status).toBe("pass")
    expect(r.back!.floors.length).toBeGreaterThan(0)
    expect(r.failed).toMatchObject({ reason: CHECK_REASONS[6], exitCode: exitCodeForCheck(6) })
  })
})

describe("expected.json is reviewed, never rewritten by CI", () => {
  it("both CI surfaces run drill:ci, and neither can pass a regeneration flag", () => {
    for (const file of ["amplify.yml", ".github/workflows/gate.yml"]) {
      const lines = readFileSync(join(ROOT, file), "utf8").split("\n").filter((l) => l.includes("drill:ci") && !l.trim().startsWith("#"))
      expect(lines.length, file).toBeGreaterThan(0)
      for (const l of lines) expect(l, file).not.toMatch(/write-expected|update/)
    }
  })

  it("--write-expected refuses to run in CI", () => {
    const res = spawnSync(join(ROOT, "node_modules/.bin/vite-node"), ["--config", "vitest.config.ts", "tools/drill/ci/cli.ts", "--write-expected"], {
      cwd: ROOT,
      env: { ...process.env, CI: "true" },
      encoding: "utf8",
    })
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("never runs in CI")
    expect(readExpected()).toEqual(expected)
  }, 30_000)
})
