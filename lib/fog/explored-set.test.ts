import { gridDisk, latLngToCell } from "h3-js"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  BLOB_VERSION,
  BlobFormatError,
  bigToCell,
  cellToBig,
  encodeDeltaBlob,
  encodeExploredBlob,
} from "@/src/domain/explored-blob"
import { parentOf, RES } from "@/src/domain/fog"

import { decodeStats, resetDecodeStats } from "./decode"
import { DeltaSkewError, ExploredSet, type BucketInvalidator } from "./explored-set"

/**
 * Ticket `0054`, criteria 1, 2 and 9. `05-fog-of-war.md` §7.1, §7.4; `02` §6.3, §6.5.
 *
 * SYNTHETIC GEOGRAPHY, POINT NEMO (08 §7.2, D-199) — the same origin `0049`'s tests use,
 * and for the same reason: this repository is public and a real trace is a home address.
 */
const ORIGIN = latLngToCell(-48.876, -123.393, RES)

const sortBig = (cells: readonly string[]): bigint[] =>
  cells.map(cellToBig).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

beforeEach(() => resetDecodeStats())

describe("decoding the set", () => {
  /**
   * CRITERION 1, against `0049`'s own fixture. R3's five-year pessimistic case is 147,782
   * cells; `gridDisk(ORIGIN, 225)` is 152,551 — the densest arrangement a set that size
   * can take, so every varint is as short as it will ever be and the decoder's loop is
   * exercised at full length.
   */
  const bigDisc = sortBig(gridDisk(ORIGIN, 225))

  it("round-trips the 150k-cell fixture to the identical sorted set", () => {
    expect(bigDisc.length).toBeGreaterThan(150_000)

    const set = ExploredSet.fromBlob(encodeExploredBlob(bigDisc, 412))

    expect(set.size).toBe(bigDisc.length)
    expect(set.generation).toBe(412)
    expect([...set.cells]).toEqual(bigDisc)
  })

  /**
   * CRITERION 2. `05` §7.1 keeps BOTH representations deliberately — the typed array is
   * what the render buckets iterate, the `Set` is what `has()` answers from — and the one
   * way that goes wrong is silently: they are built in the same pass, so a bug that drops
   * a cell from one and not the other produces a map that renders ground it then says is
   * unexplored. This is the test that would catch it.
   */
  it("builds both representations and they agree, cell for cell", () => {
    const cells = sortBig(gridDisk(ORIGIN, 12))
    const set = ExploredSet.fromBlob(encodeExploredBlob(cells, 9))

    expect(set.size).toBe(cells.length)
    for (const cell of cells) expect(set.has(bigToCell(cell))).toBe(true)
    for (let i = 0; i < set.cells.length; i++) {
      expect(set.has(bigToCell(set.cells[i]!))).toBe(true)
    }

    // And a cell that is genuinely outside the disc is absent from both.
    const outside = gridDisk(ORIGIN, 14).filter((c) => !cells.includes(cellToBig(c)))
    expect(outside.length).toBeGreaterThan(0)
    expect(set.has(outside[0]!)).toBe(false)
  })

  /**
   * CRITERION 10, the half a machine can answer. *"Decode of a 150k fixture completes in
   * under ~150 ms on the target phone; the number is recorded."*
   *
   * A LAPTOP IS NOT THE TARGET PHONE, and this test does not pretend otherwise. The
   * ceiling below is deliberately loose — it is a regression guard against an accidental
   * O(n log n) or a per-cell allocation, not a claim about D-124's mid-range Android. The
   * phone's number comes from the `?fog=debug` readout, on the phone, and is recorded in
   * the ticket's `## Operator validation`.
   *
   * The printed line is the point of the test as much as the assertion is.
   */
  it("decodes 150k cells and reports the time, as a regression floor", () => {
    const bytes = encodeExploredBlob(bigDisc, 412)
    const set = ExploredSet.fromBlob(bytes)

    expect(set.size).toBe(bigDisc.length)
    console.log(
      `0054 criterion 10 — ${bigDisc.length.toLocaleString()} cells: ` +
        `parse ${decodeStats.lastParseMs.toFixed(1)} ms, ` +
        `parse + Set build ${decodeStats.lastBlobMs.toFixed(1)} ms ` +
        `(${bytes.length.toLocaleString()} bytes, this machine — NOT the target phone)`,
    )
    expect(decodeStats.lastBlobMs).toBeLessThan(2_000)
  })

  it("stays sorted ascending, which is what the render buckets rely on", () => {
    const set = ExploredSet.fromBlob(encodeExploredBlob(sortBig(gridDisk(ORIGIN, 6)), 3))
    for (let i = 1; i < set.cells.length; i++) {
      expect(set.cells[i]! > set.cells[i - 1]!).toBe(true)
    }
  })

  it("refuses an unknown version rather than guessing at the bytes", () => {
    const bytes = encodeExploredBlob(sortBig(gridDisk(ORIGIN, 2)), 1)
    bytes[4] = BLOB_VERSION + 7
    expect(() => ExploredSet.fromBlob(bytes)).toThrow(BlobFormatError)
  })

  it("refuses a res that is not 10 (D-115)", () => {
    const bytes = encodeExploredBlob(sortBig(gridDisk(ORIGIN, 2)), 1)
    bytes[5] = 9
    expect(() => ExploredSet.fromBlob(bytes)).toThrow(/res 9/)
  })

  /**
   * CRITERION 3's structural half. `fromCells` is the warm-start constructor and it must
   * not be able to reach a decoder — the whole value of "a warm start does no LEB128
   * parsing" rests on there being no path from here to one.
   */
  it("builds from a cached array without parsing anything", () => {
    const cells = BigUint64Array.from(sortBig(gridDisk(ORIGIN, 5)))
    const set = ExploredSet.fromCells(cells, 41)

    expect(set.size).toBe(cells.length)
    expect(set.has(bigToCell(cells[0]!))).toBe(true)
    expect(decodeStats.blobDecodes).toBe(0)
  })
})

describe("applying a delta", () => {
  /**
   * A base and an add that are genuinely disjoint and in two different res-6 parents.
   * `gridDisk(ORIGIN, 3)` is one neighbourhood; the far cell is chosen by walking out
   * until the parent changes, so the test does not assume how many res-10 rings fit in a
   * res-6 hexagon.
   */
  const base = sortBig(gridDisk(ORIGIN, 3))
  const homeParent = parentOf(ORIGIN)
  /**
   * Interior to its res-6 parent, not merely inside a different one. The first cell whose
   * parent differs sits ON the boundary, so a ring around it straddles two parents — and
   * a test written against that cell asserts the opposite of what criterion 9 means.
   */
  const far = gridDisk(ORIGIN, 60).find((c) => {
    const parent = parentOf(c)
    return parent !== homeParent && gridDisk(c, 2).every((n) => parentOf(n) === parent)
  })!

  const setAt = (generation: number) =>
    ExploredSet.fromBlob(encodeExploredBlob(base, generation))

  it("merges the adds and keeps the array sorted and unique", () => {
    const set = setAt(41)
    const added = sortBig(gridDisk(far, 1))

    const result = set.applyDelta({ fromGen: 41, toGen: 42, added })

    expect(set.generation).toBe(42)
    expect(set.size).toBe(base.length + added.length)
    expect(result.added).toHaveLength(added.length)
    for (let i = 1; i < set.cells.length; i++) {
      expect(set.cells[i]! > set.cells[i - 1]!).toBe(true)
    }
    for (const cell of added) expect(set.has(bigToCell(cell))).toBe(true)
  })

  /**
   * CRITERION 9. `05` §7.4: *"Invalidate only what changed."* One run touches 1–2 res-6
   * parents, and the difference between invalidating those and invalidating everything is
   * the difference between new territory appearing and the whole map visibly rebuilding —
   * this ticket's third operator check.
   */
  it("invalidates only the touched res-6 parents, and every registered bucket", () => {
    const set = setAt(41)
    const first: BucketInvalidator = { invalidateParents: vi.fn() }
    const second: BucketInvalidator = { invalidateParents: vi.fn() }
    set.addInvalidator(first)
    set.addInvalidator(second)

    const added = sortBig([far])
    set.applyDelta({ fromGen: 41, toGen: 42, added })

    const expected = [parentOf(far)]
    expect(first.invalidateParents).toHaveBeenCalledTimes(1)
    expect(first.invalidateParents).toHaveBeenCalledWith(expected)
    expect(second.invalidateParents).toHaveBeenCalledWith(expected)
    // The home parent holds every base cell and NOTHING was added to it.
    expect(expected).not.toContain(homeParent)
  })

  it("reports each touched parent once, however many cells landed in it", () => {
    const set = setAt(41)
    const spy: BucketInvalidator = { invalidateParents: vi.fn() }
    set.addInvalidator(spy)

    const added = sortBig(gridDisk(far, 2))
    expect(added.length).toBeGreaterThan(10)
    const { parents } = set.applyDelta({ fromGen: 41, toGen: 42, added })

    expect(new Set(parents).size).toBe(parents.length)
    expect(parents.length).toBeLessThanOrEqual(added.length)
    expect(spy.invalidateParents).toHaveBeenCalledWith(parents)
  })

  it("removes an invalidator when its registration is called back", () => {
    const set = setAt(41)
    const spy: BucketInvalidator = { invalidateParents: vi.fn() }
    set.addInvalidator(spy)()

    set.applyDelta({ fromGen: 41, toGen: 42, added: sortBig([far]) })
    expect(spy.invalidateParents).not.toHaveBeenCalled()
  })

  /**
   * `02` §6.5: *"assert `delta.fromGen === state.generation` before applying; on mismatch,
   * fall back to a full fetch."* The assertion is here; `boot.ts` owns the fallback.
   */
  it("throws DeltaSkewError rather than applying a hop that does not belong", () => {
    const set = setAt(41)
    expect(() => set.applyDelta({ fromGen: 40, toGen: 41, added: sortBig([far]) })).toThrow(
      DeltaSkewError,
    )
    // And nothing was applied — a rejected hop must leave the set exactly as it was.
    expect(set.generation).toBe(41)
    expect(set.size).toBe(base.length)
  })

  it("advances the generation on an empty delta — a run over entirely known ground", () => {
    const set = setAt(41)
    const spy: BucketInvalidator = { invalidateParents: vi.fn() }
    set.addInvalidator(spy)

    const result = set.applyDelta({ fromGen: 41, toGen: 42, added: [] })

    expect(set.generation).toBe(42)
    expect(set.size).toBe(base.length)
    expect(result.added).toEqual([])
    // Nothing changed, so no bucket is dirty. Invalidating here would rebuild the map for
    // a run that revealed nothing.
    expect(spy.invalidateParents).not.toHaveBeenCalled()
  })

  it("collapses a cell the set already held rather than storing it twice", () => {
    const set = setAt(41)
    // The server computes adds against the previous generation, so this should not happen
    // — but uniqueness is assumed by every consumer, so a duplicate must collapse. D-020
    // makes re-revealing explored ground a no-op by definition, never a conflict.
    const already = sortBig([bigToCell(base[0]!)])
    const result = set.applyDelta({ fromGen: 41, toGen: 42, added: already })

    expect(set.size).toBe(base.length)
    expect(result.added).toEqual([])
  })

  it("chains hops in order, each validated against the one before it", () => {
    const set = setAt(41)
    const firstAdd = sortBig([far])
    const secondAdd = sortBig(gridDisk(far, 1).filter((c) => cellToBig(c) !== cellToBig(far)))

    set.applyDelta({ fromGen: 41, toGen: 42, added: firstAdd })
    set.applyDelta({ fromGen: 42, toGen: 43, added: secondAdd })

    expect(set.generation).toBe(43)
    expect(set.size).toBe(base.length + firstAdd.length + secondAdd.length)
  })

  /** The wire format the hops actually arrive in, decoded by the shared domain decoder. */
  it("applies a hop that came through the real LSFD encoder", async () => {
    const { decodeDelta } = await import("./decode")
    const set = setAt(41)
    const added = sortBig(gridDisk(far, 1))

    set.applyDelta(decodeDelta(encodeDeltaBlob(added, 41, 42)))

    expect(set.generation).toBe(42)
    expect(set.has(far)).toBe(true)
    expect(decodeStats.deltaDecodes).toBe(1)
  })
})
