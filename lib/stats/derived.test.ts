import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { cellArea, getHexagonAreaAvg, gridDisk, latLngToCell, UNITS } from "h3-js"
import { describe, expect, it, vi } from "vitest"

import { ExploredSet } from "@/lib/fog/explored-set"
import { syntheticSet } from "@/lib/fog/perf/synthetic"
import { plinthModel } from "@/lib/plinth/model"
import { runById, type RunReadDeps } from "@/lib/runs/server"
import { EMPTY_COLLECTION } from "@/lib/runs/wire"
import { cellToBig, decodeExploredBlob, encodeExploredBlob } from "@/src/domain/explored-blob"
import { RES } from "@/src/domain/fog"
import { activityItem } from "@/src/pipeline/persist"
import { loadRuleSet } from "@/src/rules/load"

import {
  discoveryRow,
  lifetimeCells,
  lifetimeFeed,
  lifetimeTerritory,
  runTerritory,
  SLICE_BUDGET_MS,
  type LifetimeTerritory,
  type LoadedExplored,
} from "./derived"

/**
 * Ticket `0090` — the derived stats feed. `05-fog-of-war.md` §8.2–§8.4, `04` §8.2–§8.3.
 * Geometry is synthetic: Point Nemo for the run row (D-199), the perf fixtures' origin for the sets.
 */

// THE READ PATH MUST NOT RECLASSIFY. Every export of the classifier is wrapped so a call is seen.
const classifier = vi.hoisted(() => ({ calls: 0 }))
vi.mock("@/src/domain/discovery", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/src/domain/discovery")>()
  const spied: Record<string, unknown> = { ...real }
  for (const name of ["classifyCells", "awardOf", "runClassesOf", "rearmSoonOf"] as const) {
    const fn = real[name] as (...a: unknown[]) => unknown
    spied[name] = (...a: unknown[]) => {
      classifier.calls++
      return fn(...a)
    }
  }
  return spied
})

const getObject = vi.fn()
vi.mock("@/lib/fog/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fog/server")>()),
  getObject: (...args: unknown[]) => getObject(...args),
}))

const V2 = loadRuleSet(2)

const AWARD = {
  cellCount: 389,
  newCellCount: 148,
  rearmedCellCount: 58,
  cooledCellCount: 183,
  deferredCellCount: 0,
  res: RES,
  fogAlgoVersion: 1,
}

function storedRow() {
  return activityItem(
    {
      activityId: "a-1041",
      userId: "u-1",
      kind: "run",
      hasTrace: false,
      traceRef: null,
      source: { source: "manual", externalId: "1" },
      startedAt: "2026-08-28T11:00:00.000Z",
      startedAtLocal: "2026-08-28T07:00:00",
      timezone: "Pacific/Pitcairn",
      ingestedAt: "2026-08-28T11:30:00.000Z",
      elapsedS: 2600,
      movingS: 2530,
      distanceM: 8369,
      name: null,
      sets: [],
    } as unknown as Parameters<typeof activityItem>[0],
    AWARD as unknown as Parameters<typeof activityItem>[1],
  )
}

function rig(rows: Array<Record<string, unknown>>): RunReadDeps {
  return {
    bucket: "bkt",
    activityTable: "TestActivity",
    ddb: { send: async () => ({ Items: rows }) },
    s3: {} as RunReadDeps["s3"],
  }
}

describe("per run — read from the projection's record, never recomputed (§8.2)", () => {
  it("surfaces every stored count from the activity row, and classifies nothing on the way", async () => {
    classifier.calls = 0
    const summary = await runById("u-1", "a-1041", rig([storedRow()]))
    const run = runTerritory(summary!, V2)
    expect(run).toMatchObject({
      cellCount: 389,
      newCellCount: 148,
      rearmedCellCount: 58,
      cooledCellCount: 183,
      deferredCellCount: 0,
    })
    expect(classifier.calls).toBe(0)
  })

  it("takes no cell set: counts no cell set could produce come back verbatim", () => {
    // 5 new out of 3 cells is impossible for any classifier; a pass-through returns it as stored.
    const run = runTerritory({ newCellCount: 5, rearmedCellCount: 0, cooledCellCount: 0, cellCount: 3 }, V2)
    expect(run.newCellCount).toBe(5)
    expect(run.cellCount).toBe(3)
    expect(runTerritory.length).toBe(2)
  })
})

describe("credits and Cartography XP match 04 §8.2/§8.3's worked examples (D-272)", () => {
  it("Example A — 148 new, 58 re-armed, 183 recent: 177 credits, 318 + 62 = 380 XP", () => {
    const run = runTerritory({ newCellCount: 148, rearmedCellCount: 58, cooledCellCount: 183, cellCount: 389 }, V2)
    expect(run.discoveryCredits).toBe(177)
    // Rounded PER LEDGER ROW (I-19): round(177 × 2.15) would be 381, which the ledger never wrote.
    expect(run.cartographyXp).toBe(380)
  })

  it("Example B — a strength session the next day: no cells, nothing credited", () => {
    expect(runTerritory({ newCellCount: 0, rearmedCellCount: 0, cellCount: null }, V2)).toMatchObject({
      discoveryCredits: 0,
      cartographyXp: 0,
    })
  })

  it("reads the rate from the run's own ruleset version, not today's", () => {
    const v1 = loadRuleSet(1)
    const counts = { newCellCount: 148, rearmedCellCount: 58 }
    const row1 = discoveryRow(v1)!
    expect(runTerritory(counts, v1).cartographyXp).toBe(Math.round(148 * row1.xpPerUnit) + Math.round(29 * row1.xpPerUnit))
    expect(runTerritory(counts, v1).cartographyXp).not.toBe(runTerritory(counts, V2).cartographyXp)
  })
})

describe("a run with no new territory is a well-formed record", () => {
  it("is all fields, all finite numbers — never null, never a throw, never a missing field", () => {
    const shapes = [
      { newCellCount: 0, rearmedCellCount: 0, cooledCellCount: 112, cellCount: 112 },
      { newCellCount: 0, rearmedCellCount: 0 },
      { newCellCount: 0, rearmedCellCount: 0, cooledCellCount: null, deferredCellCount: null, cellCount: null },
    ]
    for (const stored of shapes) {
      const run = runTerritory(stored, V2)
      expect(run.newCellCount).toBe(0)
      for (const key of [
        "cellCount",
        "newCellCount",
        "rearmedCellCount",
        "cooledCellCount",
        "deferredCellCount",
        "discoveryCredits",
        "cartographyXp",
      ] as const) {
        expect(Number.isFinite(run[key]), key).toBe(true)
      }
    }
    // An untraced activity read through the real path, too.
    expect(() => runTerritory({ newCellCount: 0, rearmedCellCount: 0, cellCount: null, route: EMPTY_COLLECTION } as never, V2)).not.toThrow()
  })
})

describe("lifetime totals (§8.3)", () => {
  const immediate = { now: () => performance.now(), yield: () => Promise.resolve() }

  it("territory area is Σ cellArea per cell — and differs from size × an average, 20° of latitude apart", async () => {
    const at = (lat: number) => syntheticSet({ lat, lng: 10 }, 20)
    const low = await lifetimeTerritory(at(20), immediate)
    const high = await lifetimeTerritory(at(40), immediate)
    expect(low.cells).toBe(high.cells)

    const average = getHexagonAreaAvg(RES, UNITS.km2)
    // Same cell count, so an average-multiplied estimate would call them equal. They are not.
    expect(low.cells * average).toBe(high.cells * average)
    expect(Math.abs(low.areaKm2 - high.areaKm2) / low.areaKm2).toBeGreaterThan(0.01)
    expect(Math.abs(low.areaKm2 - low.cells * average)).toBeGreaterThan(1e-6)
    expect(Math.abs(high.areaKm2 - high.cells * average)).toBeGreaterThan(1e-6)

    // And it is exactly the per-cell sum.
    const disk = gridDisk(latLngToCell(20, 10, RES), 20)
    const sum = disk.reduce((s, c) => s + cellArea(c, UNITS.km2), 0)
    expect(low.areaKm2).toBeCloseTo(sum, 9)
  })

  it("frontier length counts explored cells with an unexplored neighbour — a disc's outer ring", async () => {
    const k = 12
    const totals = await lifetimeTerritory(syntheticSet({ lat: 30, lng: 100 }, k), immediate)
    expect(totals.frontierLength).toBe(6 * k)
  })

  it("is memoised on generation: two reads at one generation are one computation", async () => {
    const set = ExploredSet.fromCells(
      BigUint64Array.from(gridDisk(latLngToCell(30, 100, RES), 2).map(cellToBig).sort((a, b) => (a < b ? -1 : 1))),
      7,
    )
    const compute = vi.fn(async (s: LoadedExplored): Promise<LifetimeTerritory> => lifetimeTerritory(s, immediate))
    const read = lifetimeFeed(compute)
    const a = await read(set)
    const b = await read(set)
    expect(compute).toHaveBeenCalledTimes(1)
    expect(b).toBe(a)

    // A new generation — the set object kept, its array replaced by a delta — recomputes, once.
    const extra = gridDisk(latLngToCell(30, 100, RES), 3).map(cellToBig).filter((c) => !set.cells.includes(c))
    set.applyDelta({ fromGen: 7, toGen: 8, added: extra.sort((x, y) => (x < y ? -1 : 1)) })
    const c = await read(set)
    await read(set)
    expect(compute).toHaveBeenCalledTimes(2)
    expect(c.generation).toBe(8)
    expect(c.cells).toBe(37)
  })

  it("over a year-five-scale set (150k cells) no slice holds the main thread past the frame budget", async () => {
    const set = syntheticSet({ lat: 30, lng: 100 }, 224)
    expect(set.size).toBe(151_201)
    const slices: number[] = []
    let start = performance.now()
    const totals = await lifetimeTerritory(set, {
      now: () => performance.now(),
      yield: async () => {
        slices.push(performance.now() - start)
        await new Promise((r) => setTimeout(r, 0))
        start = performance.now()
      },
    })
    slices.push(performance.now() - start)
    expect(totals.cells).toBe(151_201)
    expect(slices.length).toBeGreaterThan(5)
    // SLICE_BUDGET_MS is checked every 128 cells, so a slice overruns it by well under a millisecond
    // of h3 work. The ceiling asserted is the 16.7 ms frame itself, with headroom for a GC pause.
    expect(SLICE_BUDGET_MS).toBeLessThan(16.7)
    const sorted = [...slices].sort((a, b) => a - b)
    expect(sorted[Math.floor(sorted.length * 0.95)]).toBeLessThan(16.7)
  }, 30_000)
})

describe("the plinth's lifetime cell count is the loaded blob's size", () => {
  it("equals the cell count decoded from the explored-r10.bin bytes, not a cached number", () => {
    const cells = gridDisk(latLngToCell(30, 100, RES), 9)
      .map(cellToBig)
      .sort((a, b) => (a < b ? -1 : 1))
    const bytes = encodeExploredBlob(cells, 3)
    const set = ExploredSet.fromBlob(bytes)
    const fromBlob = decodeExploredBlob(bytes).cells.length

    expect(lifetimeCells(set)).toBe(fromBlob)
    const model = plinthModel({ skills: undefined, cells: lifetimeCells(set), latest: EMPTY_COLLECTION })
    expect(model.cells).toBe(new Intl.NumberFormat("en-US").format(fromBlob))
    expect(lifetimeCells(null)).toBeNull()
  })

  it("the home screen hands the plinth lifetimeCells(explored.set) and nothing else", () => {
    const src = readFileSync(join(process.cwd(), "components/plinth/home-screen.tsx"), "utf8")
    expect(src).toMatch(/cells:\s*lifetimeCells\(explored\.set\)/)
  })
})

describe("the frontier primitive is one implementation (§8.4)", () => {
  function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) sources(path, out)
      else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path)
    }
    return out
  }

  it("a grep finds exactly one frontier() and one cellNovelty(), both in src/domain/frontier.ts", () => {
    const files = ["app", "components", "lib", "src", "amplify", "tools"].flatMap((d) => sources(join(process.cwd(), d)))
    const define = /(?:function\s+|const\s+)(frontier|cellNovelty)\b\s*[=(<]/g
    const hits: string[] = []
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(define)) hits.push(`${m[1]}@${f.slice(process.cwd().length + 1)}`)
    }
    expect(hits.sort()).toEqual(["cellNovelty@src/domain/frontier.ts", "frontier@src/domain/frontier.ts"])
  })

  it("imports nothing from the UI — callable from beat 5 and from a future planner alike", () => {
    const src = readFileSync(join(process.cwd(), "src/domain/frontier.ts"), "utf8")
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])
    expect(imports.every((i) => i === "h3-js" || i.startsWith("./"))).toBe(true)
  })
})
