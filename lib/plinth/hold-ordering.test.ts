import { gridDisk, latLngToCell } from "h3-js"
import { describe, expect, it } from "vitest"

import { ExploredSet } from "@/lib/fog/explored-set"
import { homeTerritoryView } from "@/lib/fog/home-territory"
import { memoryLogStore } from "@/lib/log/queue"
import type { RunFeatureCollection } from "@/lib/runs/wire"
import { cellToBig } from "@/src/domain/explored-blob"
import { RES } from "@/src/domain/fog"

import { latestRunKey, loadLatestRun } from "./latest-run"
import { answersFor, homeHold, type AnswerTag } from "./states"

/**
 * TICKET `0273` — NO FRAME ON `/` DRAWS AN UNSEEN RUN'S NEW CELLS BEFORE THE HOLD APPLIES.
 *
 * The explored-set delta for a newly landed run arrives one request BEFORE the latest-run refetch
 * that names the run. These tests deliver the two in exactly that order, through the real pieces —
 * `ExploredSet.applyDelta` (in place, as `boot.ts` does), `loadLatestRun` with a request held open,
 * `answersFor`/`homeHold` (what `HomeScreen` computes in render) and `homeTerritoryView` (what
 * `useFogMask` draws) — and check the territory after EVERY state change, which is every frame the
 * map could be asked to draw.
 *
 * The vitest environment is `node` (`vitest.config.ts`), so React is not mounted. What the React
 * wiring adds is only that `HomeScreen` reads the explored generation from the same context, in the
 * same render, as the fog — asserted at the end as a tripwire.
 *
 * SYNTHETIC GEOGRAPHY, POINT NEMO (D-199).
 */
const OLD = gridDisk(latLngToCell(-48.876, -123.393, RES), 2)
const NEW = gridDisk(latLngToCell(-48.9, -123.45, RES), 1).filter((c) => !OLD.includes(c))
const UID = "u-1"
const asc = (cells: readonly string[]) => cells.map(cellToBig).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

function run(id: string, newCells: string[]): RunFeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "MultiLineString", coordinates: [] } as unknown as RunFeatureCollection["features"][0]["geometry"],
        properties: {
          activityId: id,
          startedAt: "2026-10-15T11:00:00.000Z",
          name: null,
          startedAtLocal: "2026-10-15T07:00:00",
          distanceM: 5000,
          newCellCount: newCells.length,
          newCells,
        },
      },
    ],
  }
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

/** Home's state, and a frame drawn after every change to it. */
function home(set: ExploredSet, source: string) {
  const view = homeTerritoryView()
  const s = {
    explored: { generation: set.generation as number | null, source },
    latest: { type: "FeatureCollection", features: [] } as RunFeatureCollection,
    answer: null as AnswerTag | null,
    seen: true as boolean | null,
  }
  /**
   * `cells` is captured AT DRAW TIME: the live set is mutated in place by a later delta, so asking
   * an earlier frame's `drawn` afterwards would describe the present, not that frame.
   */
  const frames: { drawn: ExploredSet | null; cells: BigUint64Array | null; hold: ReturnType<typeof homeHold> }[] = []
  const frame = () => {
    const hold = homeHold(s.latest, s.seen, answersFor(s.answer, s.explored))
    const drawn = view(set, hold === null ? [] : hold)
    frames.push({ drawn, cells: drawn ? drawn.cells : null, hold })
    return frames.at(-1)!
  }
  /** What `useLatestRun` hands up: the runs and the generation they were asked for, together. */
  const emitFor = (generation: number | null) => (runs: RunFeatureCollection, from: "cache" | "network") => {
    s.latest = runs
    s.answer = { generation, network: from === "network" }
    // `seen` is re-read for a new id (`isSeen`, IndexedDB) — unknown until it answers.
    s.seen = null
    frame()
  }
  return { s, frame, frames, emitFor }
}

const drewAnyOf = (drawn: ExploredSet | null, cells: readonly string[]) => !!drawn && cells.some((c) => drawn.has(c))
/** Against a frame's captured cells. */
const frameHas = (frameCells: BigUint64Array | null, cell: string) => !!frameCells && frameCells.includes(cellToBig(cell))

describe("a run landing mid-session (criterion 1)", () => {
  it("the explored delta before the latest-run refetch: the new cells are never drawn, then held", async () => {
    const set = ExploredSet.fromCells(new BigUint64Array(asc(OLD)), 5)
    const store = memoryLogStore()
    const h = home(set, "cache")

    // Settled at generation 5 on a SEEN run A: the whole set is drawn.
    await new Promise<void>((done) =>
      loadLatestRun({ currentUid: async () => UID, store, fetchLatest: async () => run("a", []) }, (r, from) => {
        h.emitFor(5)(r, from)
        h.s.seen = true
        h.frame()
        if (from === "network") done()
      }),
    )
    expect(h.frame().drawn).toBe(set)
    expect(h.frame().drawn!.size).toBe(OLD.length)

    // 1. The delta lands — in place, as `boot.ts` applies it — and the generation moves.
    set.applyDelta({ fromGen: 5, toGen: 6, added: asc(NEW) })
    h.s.explored = { generation: 6, source: "delta" }
    const afterDelta = h.frame()
    expect(afterDelta.hold).toBe("pending")
    expect(drewAnyOf(afterDelta.drawn, NEW)).toBe(false)
    expect(afterDelta.drawn!.size).toBe(OLD.length)

    // 2. The refetch is in flight for one request. Every frame in that window is the old territory.
    const response = deferred<RunFeatureCollection>()
    loadLatestRun({ currentUid: async () => UID, store, fetchLatest: () => response.promise }, h.emitFor(6), false)
    await flush()
    h.frame()

    // 3. It answers: run B, unseen. Its `seen` flag is read next — still the old territory.
    response.resolve(run("b", NEW))
    await flush()
    expect(h.s.answer).toEqual({ generation: 6, network: true })
    expect(h.frame().hold).toBe("pending")

    // 4. `seen` answers `false`: the hold applies, and B's new cells are held back.
    h.s.seen = false
    const held = h.frame()
    expect(held.hold).toEqual(NEW)
    expect(held.drawn!.size).toBe(OLD.length)

    // No frame, before or after the delta, drew any of B's new cells.
    for (const f of h.frames) expect(NEW.some((c) => frameHas(f.cells, c))).toBe(false)
    // And once anything was drawn, nothing was fogged back over: every later frame drew all of OLD.
    // (The boot frames before `seen` first answered drew nothing at all — no layer, not a re-fog.)
    const firstDrawn = h.frames.findIndex((f) => f.cells !== null)
    expect(firstDrawn).toBeGreaterThan(-1)
    for (const f of h.frames.slice(firstDrawn)) expect(OLD.every((c) => frameHas(f.cells, c))).toBe(true)
  })

  it("a SEEN run's cells still appear once its answer lands (nothing is held for good)", async () => {
    const set = ExploredSet.fromCells(new BigUint64Array(asc(OLD)), 5)
    const h = home(set, "cache")
    h.s.answer = { generation: 5, network: true }
    expect(h.frame().drawn).toBe(set)

    set.applyDelta({ fromGen: 5, toGen: 6, added: asc(NEW) })
    h.s.explored = { generation: 6, source: "delta" }
    expect(drewAnyOf(h.frame().drawn, NEW)).toBe(false)

    h.emitFor(6)(run("b", NEW), "network")
    h.s.seen = true
    const settled = h.frame()
    expect(settled.hold).toBeNull()
    expect(settled.drawn).toBe(set)
    expect(NEW.every((c) => settled.drawn!.has(c))).toBe(true)
  })

  it("a cached answer does not vouch for a delta the network delivered", () => {
    expect(answersFor({ generation: 6, network: false }, { generation: 6, source: "delta" })).toBe(false)
    expect(answersFor({ generation: 6, network: false }, { generation: 6, source: "full" })).toBe(false)
    expect(answersFor({ generation: 5, network: true }, { generation: 6, source: "delta" })).toBe(false)
    expect(answersFor({ generation: 6, network: true }, { generation: 6, source: "delta" })).toBe(true)
  })
})

describe("a first visit with an empty latest-run cache (criterion 2)", () => {
  it("draws no fog — and so none of the unseen run's ground as territory — until /api/runs/latest answers", async () => {
    // The explored set is already here (cached), and it includes unseen run B's cells.
    const set = ExploredSet.fromCells(new BigUint64Array(asc([...OLD, ...NEW])), 6)
    const store = memoryLogStore()
    const h = home(set, "cache")
    h.s.seen = null

    const response = deferred<RunFeatureCollection>()
    loadLatestRun({ currentUid: async () => UID, store, fetchLatest: () => response.promise }, h.emitFor(6))
    await flush()
    // Nothing cached, so nothing emitted: no answer, the hold is pending, and NOTHING is drawn —
    // the same no-layer state as before the explored set itself had loaded (D-319).
    expect(h.s.answer).toBeNull()
    const waiting = h.frame()
    expect(waiting.hold).toBe("pending")
    expect(waiting.drawn).toBeNull()

    response.resolve(run("b", NEW))
    await flush()
    h.s.seen = false
    const held = h.frame()
    expect(held.hold).toEqual(NEW)
    expect(held.drawn!.size).toBe(OLD.length)
    for (const f of h.frames) expect(NEW.some((c) => frameHas(f.cells, c))).toBe(false)
  })

  it("with a cached answer, a cold start still draws its fog before any request (06 §4.8)", async () => {
    const set = ExploredSet.fromCells(new BigUint64Array(asc(OLD)), 5)
    const store = memoryLogStore()
    await store.setKv(latestRunKey(UID), run("a", []))
    const h = home(set, "cache")
    const timeline: string[] = []
    const never = new Promise<RunFeatureCollection>(() => {})
    loadLatestRun(
      {
        currentUid: async () => UID,
        store,
        fetchLatest: () => {
          timeline.push("request")
          return never
        },
      },
      (r, from) => {
        h.emitFor(5)(r, from)
        h.s.seen = true
        if (h.frame().drawn) timeline.push("drawn")
      },
    )
    await flush()
    expect(timeline).toEqual(["drawn", "request"])
  })
})

describe("the React wiring (tripwire)", () => {
  it("HomeScreen decides the hold in render from the explored context, not in an effect", async () => {
    const { readFileSync } = await import("node:fs")
    const screen = readFileSync(new URL("../../components/plinth/home-screen.tsx", import.meta.url), "utf8")
    expect(screen).toContain("const answered = answersFor(answer, explored)")
    expect(screen).toContain("homeHold(latest, seen, answered)")
    // The runs and what they answer for are handed up in ONE call, so they cannot be paired wrongly.
    const shell = readFileSync(new URL("../../components/map/map-shell.tsx", import.meta.url), "utf8")
    expect(shell).toContain("onLatestRun?.(runs, answer)")
  })
})
