import { gridDisk, latLngToCell } from "h3-js"
import { describe, expect, it } from "vitest"

import {
  BLOB_VERSION,
  BlobFormatError,
  bigToCell,
  cellToBig,
  decodeDeltaBlob,
  decodeExploredBlob,
  decodeLastRunBlob,
  encodeDeltaBlob,
  encodeExploredBlob,
  encodeLastRunBlob,
  FLAG_COMPACTED,
  MAX_LAST_RUN_DAY,
  mergeCells,
  mergeLastRunDays,
  readVarint,
  writeVarint,
} from "./explored-blob"
import { RES } from "./fog"

/**
 * `0049`, `05-fog-of-war.md` §7.1–§7.4, `02-data-model.md` §6.1–§6.2.
 *
 * SYNTHETIC GEOGRAPHY, POINT NEMO (08 §7.2, D-199). The repo is public and a real trace is
 * a home address. Every cell here is derived from one origin in the South Pacific — and
 * mostly from `gridDisk` on it, which needs no coordinates at all after the first.
 */
const ORIGIN = latLngToCell(-48.876, -123.393, RES)

const sortBig = (cells: readonly string[]): bigint[] =>
  cells.map(cellToBig).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

describe("cell ids as the u64 they are", () => {
  it("round-trips every id in a disc", () => {
    for (const cell of gridDisk(ORIGIN, 4)) expect(bigToCell(cellToBig(cell))).toBe(cell)
  })

  it("orders identically to the hex string, which is a coincidence of equal length", () => {
    // Worth pinning: res-10 and res-6 ids are both 15 hex characters, so string order and
    // integer order agree today. The blob is defined over the INTEGER, and this test is
    // what makes the coincidence visible rather than something a reader relies on.
    const cells = gridDisk(ORIGIN, 3)
    const byString = [...cells].sort()
    const byInt = sortBig(cells).map(bigToCell)
    expect(byInt).toEqual(byString)
  })
})

describe("LEB128", () => {
  it("round-trips the boundary values of each byte width", () => {
    for (const v of [0n, 1n, 127n, 128n, 16383n, 16384n, 2n ** 32n, 2n ** 63n - 1n]) {
      const out: number[] = []
      writeVarint(out, v)
      const { value, next } = readVarint(Uint8Array.from(out), 0)
      expect(value).toBe(v)
      expect(next).toBe(out.length)
    }
  })

  it("uses one byte below 128 and two below 16384 — the claim the size estimate rests on", () => {
    const one: number[] = []
    writeVarint(one, 127n)
    expect(one).toHaveLength(1)
    const two: number[] = []
    writeVarint(two, 16383n)
    expect(two).toHaveLength(2)
  })

  it("refuses a negative value — the format has no sign bit", () => {
    expect(() => writeVarint([], -1n)).toThrow(RangeError)
  })

  it("throws on a truncated varint rather than returning what it read so far", () => {
    // The continuation bit says another byte follows. If the buffer ends, the object is
    // corrupt — reading the partial value would produce a plausible, wrong cell id.
    expect(() => readVarint(Uint8Array.from([0x80]), 0)).toThrow(/truncated/)
  })

  it("throws past 64 bits rather than silently wrapping", () => {
    expect(() => readVarint(Uint8Array.from(Array(12).fill(0x80)), 0)).toThrow(/64 bits/)
  })
})

describe("LSFG — the explored set", () => {
  /** CRITERION 1. R3's five-year pessimistic case is 147,782 cells; this is 152,551. */
  const bigDisc = sortBig(gridDisk(ORIGIN, 225))

  it("round-trips a 150k-cell fixture to the same set, in the same order", () => {
    expect(bigDisc.length).toBeGreaterThan(150_000)
    const decoded = decodeExploredBlob(encodeExploredBlob(bigDisc, 412))
    expect(decoded.cells).toEqual(bigDisc)
    expect(decoded.cells.length).toBe(bigDisc.length)
    expect(decoded.generation).toBe(412)
    expect(decoded.res).toBe(RES)
  })

  /** CRITERION 2. Every header field, at the offsets `05` §7.1 tabulates. */
  it("writes the header exactly as 05 §7.1 specifies", () => {
    const bytes = encodeExploredBlob(sortBig(gridDisk(ORIGIN, 2)), 7)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("LSFG")
    expect(bytes[4]).toBe(BLOB_VERSION)
    expect(bytes[5]).toBe(10)
    expect(bytes[6]).toBe(0)
    expect(bytes[7]).toBe(0)
    expect(view.getBigUint64(8, true)).toBe(7n)
    expect(view.getUint32(16, true)).toBe(19)
    expect(view.getBigUint64(20, true)).toBe(sortBig(gridDisk(ORIGIN, 2))[0])
  })

  /**
   * THE SIZE CLAIM, MEASURED. `05` §7 and `02` §6.2: *"delta encoding + varint gets to
   * ~2-3 bytes per cell"*, against 8 for raw u64s — which is the whole basis of "ship the
   * entire explored set to the client once per session".
   *
   * Asserted on the 150k fixture rather than a small disc: the figure is an average over a
   * large set, and a 91-cell disc measures 3.01 simply because its few large gaps are not
   * amortised. The band is stated generously at the top because this fixture is a solid
   * disc, the densest arrangement a set of this size can have.
   */
  it("costs 2-3 bytes per cell at 150k, and the header is exactly 28", () => {
    const bytes = encodeExploredBlob(bigDisc, 1)
    const perCell = (bytes.length - 28) / (bigDisc.length - 1)
    expect(perCell).toBeGreaterThan(2)
    expect(perCell).toBeLessThanOrEqual(3.05)
    // 8 bytes/cell raw is what the format exists to beat.
    expect(bytes.length).toBeLessThan(bigDisc.length * 8)
  })

  it("handles the empty set — a bootstrap, not an error", () => {
    const bytes = encodeExploredBlob([], 1)
    expect(bytes).toHaveLength(28)
    expect(decodeExploredBlob(bytes).cells).toEqual([])
  })

  it("handles a single cell — count 1, baseCell, no deltas", () => {
    const one = [cellToBig(ORIGIN)]
    expect(decodeExploredBlob(encodeExploredBlob(one, 3)).cells).toEqual(one)
  })

  /** CRITERION 2's second half: reject rather than guess (D-115, `02` §6.4). */
  it("REJECTS res !== 10 rather than decoding it", () => {
    const bytes = encodeExploredBlob(sortBig(gridDisk(ORIGIN, 1)), 1)
    bytes[5] = 9
    expect(() => decodeExploredBlob(bytes)).toThrow(/res 9, expected 10/)
  })

  it("REJECTS an unknown version rather than decoding it", () => {
    const bytes = encodeExploredBlob(sortBig(gridDisk(ORIGIN, 1)), 1)
    bytes[4] = 2
    expect(() => decodeExploredBlob(bytes)).toThrow(/unknown version 2/)
  })

  it("rejects the wrong magic — a mis-routed object fails loudly", () => {
    const bytes = encodeExploredBlob(sortBig(gridDisk(ORIGIN, 1)), 1)
    bytes[3] = "X".charCodeAt(0)
    expect(() => decodeExploredBlob(bytes)).toThrow(/expected magic "LSFG"/)
  })

  /**
   * `FLAG_COMPACTED` is specified so it can be turned on without a version bump, and no
   * reader in this repo can honour it yet. Accepting it silently would answer "not
   * explored" for every cell whose parent is present — the map losing ground.
   */
  it("rejects a compacted payload until something calls uncompactCells", () => {
    const bytes = encodeExploredBlob(sortBig(gridDisk(ORIGIN, 1)), 1, FLAG_COMPACTED)
    expect(() => decodeExploredBlob(bytes)).toThrow(/uncompactCells/)
  })

  it("rejects trailing bytes — the header and the payload must agree", () => {
    const bytes = encodeExploredBlob(sortBig(gridDisk(ORIGIN, 2)), 1)
    const longer = new Uint8Array(bytes.length + 1)
    longer.set(bytes)
    expect(() => decodeExploredBlob(longer)).toThrow(/trailing bytes/)
  })

  it("rejects a truncated object rather than returning a short set", () => {
    const bytes = encodeExploredBlob(sortBig(gridDisk(ORIGIN, 2)), 1)
    expect(() => decodeExploredBlob(bytes.subarray(0, bytes.length - 2))).toThrow(BlobFormatError)
  })

  it("refuses to encode a non-ascending array — the gaps would be negative", () => {
    const cells = sortBig(gridDisk(ORIGIN, 1))
    expect(() => encodeExploredBlob([cells[1]!, cells[0]!], 1)).toThrow(/strictly ascending/)
  })

  it("refuses to encode a duplicate — a zero gap is not representable", () => {
    const c = cellToBig(ORIGIN)
    expect(() => encodeExploredBlob([c, c], 1)).toThrow(/strictly ascending/)
  })

  /**
   * `Buffer.from` hands back a view into a POOLED ArrayBuffer with a non-zero byteOffset.
   * A decoder built on `new DataView(bytes.buffer)` reads whatever else the pool holds and
   * produces a wrong generation and a wrong count, intermittently.
   */
  it("decodes correctly from a pooled Buffer with a non-zero byteOffset", () => {
    const cells = sortBig(gridDisk(ORIGIN, 3))
    const encoded = encodeExploredBlob(cells, 99)
    const pooled = Buffer.concat([Buffer.from([1, 2, 3]), Buffer.from(encoded)]).subarray(3)
    expect(pooled.byteOffset).toBeGreaterThan(0)
    const decoded = decodeExploredBlob(pooled)
    expect(decoded.generation).toBe(99)
    expect(decoded.cells).toEqual(cells)
  })
})

describe("LSFL — the lastRunDay sidecar", () => {
  it("round-trips and stays parallel to the set", () => {
    const days = [0, 1, 2444, MAX_LAST_RUN_DAY]
    const decoded = decodeLastRunBlob(encodeLastRunBlob(days, 5))
    expect([...decoded.days]).toEqual(days)
    expect(decoded.generation).toBe(5)
  })

  it("refuses a value outside u16 — that is an unparsed or pre-epoch timestamp", () => {
    expect(() => encodeLastRunBlob([MAX_LAST_RUN_DAY + 1], 1)).toThrow(RangeError)
    expect(() => encodeLastRunBlob([-1], 1)).toThrow(RangeError)
  })

  /**
   * D-219. §7.2 describes this object as bare parallel u16s; the header is added so a
   * misaligned sidecar is detectable. This is the assertion that makes the header earn it.
   */
  it("carries its own generation and count, so a mismatched fetch is detectable", () => {
    const bytes = encodeLastRunBlob([1, 2, 3], 41)
    expect(decodeLastRunBlob(bytes).generation).toBe(41)
    expect(decodeLastRunBlob(bytes).days).toHaveLength(3)
  })

  it("rejects a length that disagrees with its own count", () => {
    const bytes = encodeLastRunBlob([1, 2, 3], 41)
    expect(() => decodeLastRunBlob(bytes.subarray(0, bytes.length - 2))).toThrow(/parallel/)
  })

  it("rejects res !== 10 and an unknown version, like every other object here", () => {
    const bytes = encodeLastRunBlob([1], 1)
    const bad = Uint8Array.from(bytes)
    bad[5] = 8
    expect(() => decodeLastRunBlob(bad)).toThrow(/res 8/)
  })
})

describe("LSFD — the mid-session delta", () => {
  it("round-trips the adds", () => {
    const added = sortBig(gridDisk(ORIGIN, 2))
    const decoded = decodeDeltaBlob(encodeDeltaBlob(added, 41, 42))
    expect(decoded).toEqual({ fromGen: 41, toGen: 42, added })
  })

  /**
   * A run over entirely known ground. Written rather than omitted, so a client never has
   * to tell "no new cells" from "the object is missing" — the second answer costs a
   * 300 KB full fetch on the cheapest possible case.
   */
  it("encodes an empty delta in exactly the header", () => {
    const bytes = encodeDeltaBlob([], 41, 42)
    expect(bytes).toHaveLength(36)
    expect(decodeDeltaBlob(bytes).added).toEqual([])
  })

  it("refuses toGen <= fromGen — I-11 in the encoder", () => {
    expect(() => encodeDeltaBlob([], 42, 42)).toThrow(/I-11/)
    expect(() => encodeDeltaBlob([], 42, 41)).toThrow(/I-11/)
  })

  /**
   * `05` §7.4: *"Adds only. There is no removal opcode, and there must never be one."* The
   * structural argument, not a policy: the format cannot express a removal, so a malformed
   * payload cannot un-reveal ground. The test for that is that the ONLY body content is
   * ascending gaps, and anything else is refused.
   */
  it("has no removal opcode — a zero gap (the obvious escape) is rejected", () => {
    const added = sortBig(gridDisk(ORIGIN, 1))
    const bytes = encodeDeltaBlob(added, 1, 2)
    bytes[36] = 0 // first varint -> 0
    expect(() => decodeDeltaBlob(bytes)).toThrow(/zero gap/)
  })

  it("rejects a body on a zero-count delta", () => {
    const bytes = new Uint8Array(37)
    bytes.set(encodeDeltaBlob([], 1, 2))
    expect(() => decodeDeltaBlob(bytes)).toThrow(/body bytes/)
  })
})

describe("mergeCells — §2.10 step 3", () => {
  it("adds only what is new and keeps the result sorted", () => {
    const base = sortBig(gridDisk(ORIGIN, 3))
    const touched = sortBig(gridDisk(ORIGIN, 4))
    const merged = mergeCells(base, touched)

    expect(merged.cells).toEqual(touched)
    expect(merged.added).toEqual(touched.filter((c) => !base.includes(c)))
    expect(merged.added.length).toBe(touched.length - base.length)
  })

  it("adds nothing when the run is entirely over known ground", () => {
    const base = sortBig(gridDisk(ORIGIN, 4))
    const merged = mergeCells(base, sortBig(gridDisk(ORIGIN, 2)))
    expect(merged.added).toEqual([])
    expect(merged.cells).toEqual(base)
  })

  it("bootstraps from an empty base", () => {
    const touched = sortBig(gridDisk(ORIGIN, 2))
    const merged = mergeCells([], touched)
    expect(merged.cells).toEqual(touched)
    expect(merged.added).toEqual(touched)
    expect([...merged.fromBase]).toEqual(touched.map(() => -1))
  })

  it("sorts and de-duplicates its input, so a caller may pass a raw list", () => {
    const cells = sortBig(gridDisk(ORIGIN, 1))
    const merged = mergeCells([], [...cells, ...cells].reverse())
    expect(merged.cells).toEqual(cells)
  })

  it("maps every surviving output back to its base index", () => {
    const base = sortBig(gridDisk(ORIGIN, 2))
    const merged = mergeCells(base, sortBig(gridDisk(ORIGIN, 3)))
    for (let i = 0; i < merged.cells.length; i++) {
      const from = merged.fromBase[i]!
      if (from >= 0) expect(base[from]).toBe(merged.cells[i])
      else expect(base).not.toContain(merged.cells[i])
    }
  })

  it("is linear and correct at 150k — the size the hot path actually sees", () => {
    const base = sortBig(gridDisk(ORIGIN, 225))
    const run = sortBig(gridDisk(ORIGIN, 226)).slice(-130)
    const merged = mergeCells(base, run)
    expect(merged.cells.length).toBe(base.length + merged.added.length)
    for (let i = 1; i < merged.cells.length; i++) {
      expect(merged.cells[i]! > merged.cells[i - 1]!).toBe(true)
    }
  })
})

describe("mergeLastRunDays — the sidecar follows the merge", () => {
  /** CRITERION 4, at the unit level: entry *i* corresponds to cell *i*, always. */
  it("stays index-parallel when new cells land in the middle of the array", () => {
    const base = sortBig(gridDisk(ORIGIN, 2))
    const baseDays = base.map((_, i) => 100 + i)
    const touched = new Set(sortBig(gridDisk(ORIGIN, 3)))
    const merged = mergeCells(base, touched)
    const days = mergeLastRunDays(baseDays, merged, touched, 2000)

    expect(days).toHaveLength(merged.cells.length)
    for (let i = 0; i < merged.cells.length; i++) {
      // Every cell in this run was touched, so every entry is today's day.
      expect(days[i]).toBe(2000)
    }
  })

  it("leaves untouched cells on the day they already had", () => {
    const base = sortBig(gridDisk(ORIGIN, 3))
    const baseDays = base.map(() => 500)
    const touched = new Set(sortBig(gridDisk(ORIGIN, 1)))
    const merged = mergeCells(base, touched)
    const days = mergeLastRunDays(baseDays, merged, touched, 900)

    for (let i = 0; i < merged.cells.length; i++) {
      expect(days[i]).toBe(touched.has(merged.cells[i]!) ? 900 : 500)
    }
  })

  /**
   * The array's half of I-8. A backfilled 2024 run must not drag a day written by a 2026
   * run backwards — the same rule T6's `ConditionExpression` enforces in DynamoDB, so the
   * blob agrees with the table without reading it.
   */
  it("takes a max, so a backfill never lowers a day", () => {
    const base = sortBig(gridDisk(ORIGIN, 1))
    const baseDays = base.map(() => 2400)
    const touched = new Set(base)
    const days = mergeLastRunDays(baseDays, mergeCells(base, touched), touched, 1000)
    expect([...days]).toEqual(base.map(() => 2400))
  })

  it("gives a newly discovered cell the day it was discovered, not zero", () => {
    const touched = new Set(sortBig(gridDisk(ORIGIN, 1)))
    const days = mergeLastRunDays([], mergeCells([], touched), touched, 1234)
    expect([...days]).toEqual([...touched].map(() => 1234))
  })
})
