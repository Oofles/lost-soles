import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { unseenIds } from "@/lib/chronicle/rows"
import { HOLD_PENDING } from "@/lib/fog/home-territory"
import { plinthModel, FRESH_RUN_TEXT } from "@/lib/plinth/model"
import { homeHold } from "@/lib/plinth/states"
import type { RunFeatureCollection, RunListItem } from "@/lib/runs/wire"

import { ALL, IMPORTED, WINDOW } from "./__fixtures__/three-hundred"
import { chronicleWithBackfill, withBackfill, type BackfillBatch } from "./batch"
import { backfillDue, backfillHold, latestSeen, mergeHolds } from "./plan"

/**
 * Ticket `0257`, criteria 2 and 3. After a 300-activity import: one reveal is due, and NOT ONE of the
 * imported activities reads as new — no `1 new run` line, no gold Chronicle row — whatever this
 * device's `seen` store says about them.
 */

const STANDING = { generation: 40, cells: 0, activities: 0, skills: [], totalLevel: 0, totalXp: 0 }
const BATCH: BackfillBatch = {
  version: 1,
  batchId: WINDOW.from,
  window: WINDOW,
  writtenAt: "2026-10-17T00:00:00.000Z",
  imported: { count: IMPORTED.length, firstStartedAt: IMPORTED[0]!.startedAt, lastStartedAt: IMPORTED.at(-1)!.startedAt },
  activityIds: IMPORTED.map((a) => a.id),
  before: STANDING,
  after: { ...STANDING, generation: 340 },
}

const collection = (activityId: string): RunFeatureCollection => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates: [[[-123.393, -48.876], [-123.392, -48.876]]] },
      properties: { activityId, startedAt: "2026-09-09T11:00:00.000Z", name: null, newCellCount: 4, newCells: ["8b0000000000000"] },
    },
  ],
})

const item = (activityId: string): RunListItem => ({
  activityId,
  startedAt: "2026-09-09T11:00:00.000Z",
  startedAtLocal: "2026-09-09T07:00:00",
  name: null,
  kind: "run",
  distanceM: 5000,
  durationS: 1800,
  newCellCount: 4,
  traced: true,
  sets: [],
})

describe("is a reveal due?", () => {
  it("not known until there is an answer, or from a cache that predates the field", () => {
    expect(backfillDue(collection("a"), null).kind).toBe("unknown")
    expect(backfillDue(collection("a"), { network: false }).kind).toBe("unknown")
  })

  it("no, from a network answer without the field (or a failed request answering with the cache)", () => {
    expect(backfillDue(collection("a"), { network: true }).kind).toBe("none")
  })

  it("no, when the account has no record; yes, with the mark, when it has one", () => {
    expect(backfillDue({ ...collection("a"), backfill: null }, { network: false }).kind).toBe("none")
    const due = backfillDue(withBackfill(collection("a"), BATCH), { network: false })
    expect(due.kind).toBe("due")
    expect(due.kind === "due" && due.mark.batchId).toBe(WINDOW.from)
  })
})

describe("what the import holds back", () => {
  const due = backfillDue(withBackfill(collection("a"), BATCH), { network: true })

  it("waits — pending — until the device has said whether it played it, and the blobs are in", () => {
    expect(backfillHold({ kind: "unknown" }, null)).toBe(HOLD_PENDING)
    expect(backfillHold(due, null)).toBe(HOLD_PENDING)
    expect(backfillHold(due, { id: WINDOW.from, kind: "checking" })).toBe(HOLD_PENDING)
    expect(backfillHold(due, { id: WINDOW.from, kind: "loading" })).toBe(HOLD_PENDING)
    expect(backfillHold(due, { id: "an older batch", kind: "done" })).toBe(HOLD_PENDING)
  })

  it("holds the import's cells until the reveal has played, then nothing", () => {
    const hold = ["8b0000000000001"]
    expect(backfillHold(due, { id: WINDOW.from, kind: "ready", hold })).toBe(hold)
    expect(backfillHold(due, { id: WINDOW.from, kind: "playing", hold })).toBe(hold)
    expect(backfillHold(due, { id: WINDOW.from, kind: "done", hold })).toBeNull()
    expect(backfillHold(due, { id: WINDOW.from, kind: "skip" })).toBeNull()
    expect(backfillHold({ kind: "none" }, null)).toBeNull()
  })

  it("merges with an unseen run's hold, pending winning", () => {
    expect(mergeHolds(null, null)).toBeNull()
    expect(mergeHolds(["a"], null)).toEqual(["a"])
    expect(mergeHolds(null, ["b"])).toEqual(["b"])
    expect(mergeHolds(["a"], ["a", "b"])).toEqual(["a", "b"])
    expect(mergeHolds(["a"], HOLD_PENDING)).toBe(HOLD_PENDING)
    // `[]` keeps the corridor off; merging nothing into it must not turn it back on.
    expect(mergeHolds([], null)).toEqual([])
  })
})

describe("no imported activity is ever new, on any device (criterion 3)", () => {
  it("the plinth shows no new-run line for any of the 300 activities' imported ones, unseen here or not", () => {
    for (const a of IMPORTED) {
      const latest = withBackfill(collection(a.id), BATCH)
      expect(latest.features[0]!.properties.backfilled).toBe(true)
      // `false`: this device's `seen` store has never heard of it.
      const seen = latestSeen(latest, false)
      expect(seen).toBe(true)
      const model = plinthModel({ skills: [], cells: 10, latest, seen })
      expect(model.lastRun?.fresh).toBeUndefined()
      expect(model.lastRun?.text).not.toBe(FRESH_RUN_TEXT)
      // And its ground is not held back as an unseen run's.
      expect(homeHold(latest, seen, true)).toBeNull()
    }
  })

  it("but a run that was not imported is still new until it is seen", () => {
    const latest = withBackfill(collection("a-new-run"), BATCH)
    expect(latestSeen(latest, false)).toBe(false)
    expect(plinthModel({ skills: [], cells: 10, latest, seen: false }).lastRun?.text).toBe(FRESH_RUN_TEXT)
  })

  it("the Chronicle gives none of them the gold mark", () => {
    const items = chronicleWithBackfill({ items: [...IMPORTED].reverse().map((a) => item(a.id)), next: null }, BATCH).items
    const unseenEverywhere = new Map(items.map((r) => [r.activityId, false]))
    expect(unseenIds(items, unseenEverywhere)).toEqual(new Set())
    // The whole 300-activity account, newest first: the newest is a run synced during the import.
    const all = chronicleWithBackfill({ items: [...ALL].reverse().map((a) => item(a.id)), next: null }, BATCH).items
    expect(all.filter((r) => r.backfilled)).toHaveLength(IMPORTED.length)
  })
})

describe("home plays ONE aggregate sequence, never one per activity (criterion 2)", () => {
  const src = readFileSync(join(process.cwd(), "components/plinth/home-screen.tsx"), "utf8")

  it("mounts one BackfillRevealSequence, keyed by the batch — not a list of them", () => {
    expect(src.match(/<BackfillRevealSequence\b/g)).toHaveLength(1)
    expect(src).toMatch(/key=\{backfill\.playing\.batchId\}/)
    expect(src).not.toMatch(/\.map\([^)]*BackfillRevealSequence/)
  })

  it("and the sequence plays one card", () => {
    const seq = readFileSync(join(process.cwd(), "components/backfill/backfill-reveal.tsx"), "utf8")
    expect(seq).toMatch(/cards=\{\[ledger\.card\]\}/)
  })
})
