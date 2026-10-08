import { QueryCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it, vi } from "vitest"

import { activityItem } from "@/src/pipeline/persist"

import { runDate, runDistance, runDuration, sourceLabel } from "./format"
import { isColdLanding, seedHomeBehind, SEED_MARKER, type HistoryHost } from "./history"
import { runLedger, type ActivityLedgerRow } from "./ledger"
import { RECENT_RUNS_LIMIT, recentRuns, runById, type RunReadDeps } from "./server"
import { EMPTY_COLLECTION, runHref } from "./wire"

/**
 * Ticket `0078` — the run page's reads and its pure helpers. DynamoDB and S3 are stubbed; rows are
 * built by the shipped writer (`activityItem`), as `server.test.ts` explains. Geometry is synthetic,
 * near Point Nemo (D-199).
 */

const GEOMETRY = { type: "MultiLineString" as const, coordinates: [[[-123.393, -48.876], [-123.392, -48.875]]] }

const getObject = vi.fn()
vi.mock("@/lib/fog/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fog/server")>()),
  getObject: (...args: unknown[]) => getObject(...args),
  defaultFogReadDeps: () => ({ s3: {}, bucket: "bkt" }),
}))

function rig(rows: Array<Record<string, unknown>>) {
  const queries: QueryCommand["input"][] = []
  const deps: RunReadDeps = {
    bucket: "bkt",
    activityTable: "TestActivity",
    ddb: {
      async send(command: QueryCommand) {
        queries.push(command.input)
        return { Items: rows }
      },
    },
    s3: {} as RunReadDeps["s3"],
  }
  return { deps, queries }
}

const row = (over: Record<string, unknown> = {}) => ({
  ...activityItem({
    activityId: "a-9",
    userId: "u-1",
    kind: "run",
    hasTrace: true,
    traceRef: "users/u-1/traces/a-9.segments.json.gz",
    source: { source: "manual", externalId: "1" },
    startedAt: "2026-08-28T11:00:00.000Z",
    startedAtLocal: "2026-08-28T07:00:00",
    timezone: "America/New_York",
    ingestedAt: "2026-08-28T11:30:00.000Z",
    elapsedS: 2600,
    movingS: 2530,
    distanceM: 8400,
    name: "Morning Run",
    sets: [],
  } as unknown as Parameters<typeof activityItem>[0]),
  ...over,
})

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

describe("runById — criterion 1: resolves for the owner, 404s otherwise", () => {
  it("queries the base table by id, not by a user index", async () => {
    getObject.mockResolvedValueOnce(bytes(GEOMETRY))
    const { deps, queries } = rig([row()])
    await runById("u-1", "a-9", deps)
    expect(queries[0]!.IndexName).toBeUndefined()
    expect(queries[0]!.ExpressionAttributeValues).toEqual({ ":id": "a-9" })
  })

  it("returns the owner's run with its stats and its line", async () => {
    getObject.mockResolvedValueOnce(bytes(GEOMETRY))
    const { deps } = rig([row()])
    const run = await runById("u-1", "a-9", deps)
    expect(run).toMatchObject({
      activityId: "a-9",
      startedAtLocal: "2026-08-28T07:00:00",
      name: "Morning Run",
      distanceM: 8400,
      elapsedS: 2600,
      movingS: 2530,
      source: "manual",
      newCellCount: 0,
    })
    expect(run!.route.features[0]!.geometry).toEqual(GEOMETRY)
  })

  it("is null for another account's run — the same null as a missing one", async () => {
    const { deps } = rig([row()])
    expect(await runById("u-someone-else", "a-9", deps)).toBeNull()
    expect(await runById("u-1", "a-9", rig([]).deps)).toBeNull()
    expect(getObject).not.toHaveBeenCalledWith(expect.stringContaining("u-someone-else"), expect.anything())
  })

  it("rebuilds the trace key from the session's uid, never the row's traceRef", async () => {
    getObject.mockResolvedValueOnce(bytes(GEOMETRY))
    const { deps } = rig([row({ traceRef: "users/SOMEONE-ELSE/traces/a-9.segments.json.gz" })])
    await runById("u-1", "a-9", deps)
    expect(getObject.mock.calls.at(-1)![0]).toBe("users/u-1/traces/a-9.segments.json.gz")
  })

  it("an untraced activity still resolves, with no line", async () => {
    getObject.mockClear()
    const { deps } = rig([row({ traceRef: null, hasTrace: false })])
    const run = await runById("u-1", "a-9", deps)
    expect(run!.route).toEqual(EMPTY_COLLECTION)
    expect(getObject).not.toHaveBeenCalled()
  })
})

describe("recentRuns — the Chronicle's links", () => {
  it("reads the caller's newest activities, newest first, bounded", async () => {
    const { deps, queries } = rig([row(), row({ id: "a-8", startedAtLocal: "2026-08-20T06:00:00" })])
    const runs = await recentRuns("u-1", deps)
    expect(queries[0]!.IndexName).toBe("byUserAndStart")
    expect(queries[0]!.ScanIndexForward).toBe(false)
    expect(queries[0]!.Limit).toBe(RECENT_RUNS_LIMIT)
    expect(queries[0]!.ExpressionAttributeValues).toEqual({ ":u": "u-1" })
    expect(runs.map((r) => r.activityId)).toEqual(["a-9", "a-8"])
  })
})

describe("runHref — the entry point's autoplay intent", () => {
  it("the Chronicle's link carries none; the plinth's asks to play", () => {
    expect(runHref("a-9")).toBe("/run/a-9")
    expect(runHref("a-9", { play: true })).toBe("/run/a-9?play=1")
  })
})

describe("runLedger — the end state's ledger", () => {
  const r = (skillId: string, xpAwarded: number, over: Partial<ActivityLedgerRow> = {}): ActivityLedgerRow => ({
    skillId, reason: "distance", xpAwarded, xpRulesVersion: 3, isFloor: false, ...over,
  })

  it("sums per skill and orders by XP gained, descending", () => {
    const out = runLedger([r("a", 100), r("b", 300), r("a", 250, { reason: "new" })])
    expect(out.lines).toEqual([{ skillId: "a", xp: 350 }, { skillId: "b", xp: 300 }])
    expect(out.totalXp).toBe(650)
  })

  it("never renders a zero: a skill that earned nothing is omitted", () => {
    expect(runLedger([r("a", 100), r("b", 0)]).lines.map((l) => l.skillId)).toEqual(["a"])
  })

  it("reads one ruleset: mid-replay rows of an older version are not double-counted", () => {
    const out = runLedger([r("a", 100, { xpRulesVersion: 2 }), r("a", 120)])
    expect(out.lines).toEqual([{ skillId: "a", xp: 120 }])
  })

  it("ignores floor rows", () => {
    expect(runLedger([r("a", 100, { isFloor: true })]).lines).toEqual([])
  })
})

describe("route stats formatting", () => {
  it("reads the date from the local wall clock", () => {
    expect(runDate("2026-08-28T23:30:00")).toBe("Fri 28 Aug 2026")
    expect(runDate("2026-08-28T07:00:00", { year: false })).toBe("Fri 28 Aug")
  })
  it("formats distance, duration and source", () => {
    expect(runDistance(8400)).toBe("8.40 km")
    expect(runDistance(null)).toBeNull()
    expect(runDistance(0)).toBeNull()
    expect(runDuration(2530)).toBe("42:10")
    expect(runDuration(3723)).toBe("1:02:03")
    expect(sourceLabel("manual")).toBe("Manual")
  })
})

describe("seedHomeBehind — criterion 5: back from a cold deep link lands on /", () => {
  function host(over: { navType?: string; navUrl?: string; path?: string; state?: unknown } = {}) {
    const calls: Array<[string, unknown, string]> = []
    const path = over.path ?? "/run/a-9"
    const h: HistoryHost = {
      history: { state: over.state ?? { __NA: true }, length: 1 },
      location: { href: `https://soles.example${path}`, pathname: path, search: "", hash: "" },
      replaceState: (d, u) => calls.push(["replace", d, u]),
      pushState: (d, u) => calls.push(["push", d, u]),
      navigation: { type: over.navType ?? "navigate", name: over.navUrl ?? `https://soles.example${path}` },
    }
    return { h, calls }
  }

  it("on a cold landing, slips a marked / under the run and re-pushes the run with Next's state", () => {
    const { h, calls } = host()
    expect(seedHomeBehind(h)).toBe(true)
    expect(calls).toEqual([
      ["replace", { [SEED_MARKER]: true }, "/"],
      ["push", { __NA: true }, "/run/a-9"],
    ])
  })

  it("the seed carries no __NA, so Next's popstate reloads / rather than restoring the run's tree", () => {
    const { h, calls } = host()
    seedHomeBehind(h)
    expect((calls[0]![1] as Record<string, unknown>).__NA).toBeUndefined()
  })

  it("does nothing after a soft navigation from inside the app", () => {
    const { h, calls } = host({ navUrl: "https://soles.example/chronicle" })
    expect(isColdLanding(h)).toBe(false)
    expect(seedHomeBehind(h)).toBe(false)
    expect(calls).toEqual([])
  })

  it("does nothing on a reload — it was seeded on the first load", () => {
    const { h, calls } = host({ navType: "reload" })
    expect(seedHomeBehind(h)).toBe(false)
    expect(calls).toEqual([])
  })

  it("a cold landing with ?play=1 is still cold", () => {
    const { h } = host({ navUrl: "https://soles.example/run/a-9?play=1" })
    expect(isColdLanding(h)).toBe(true)
  })
})
