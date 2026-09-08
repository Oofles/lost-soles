import type { H3Index } from "h3-js"

import { RES } from "./fog"

/**
 * THE WIRE FORMAT. Ticket `0049`. `05-fog-of-war.md` §7.1, §7.2, §7.4;
 * `02-data-model.md` §6.1, §6.2; R3 §2, §4, R4 §7.1.
 *
 * ─── WHY A BINARY FORMAT AT ALL, WHEN 150k IDs IS "ONLY" A FEW MB ───────────
 *
 * R3's headline is that this is a **few-megabytes problem, not a gigabytes problem**, and
 * the architectural payoff is enormous: ship the ENTIRE explored set to the browser once
 * per session, and every fog question afterwards — viewport render, % explored, new
 * territory, unexplored-zones-near-me — is an in-memory set operation with no network, no
 * server cost and no tile pipeline. `05` §7 states the consequence as three prohibitions:
 * *"Do not build a tile server. Do not build a spatial index service. Do not build a
 * per-viewport query API."*
 *
 * That claim only survives five years if the payload stays small, which is what this file
 * is. Sorted res-10 H3 ids in one metro share their high bits, so **sort → delta → LEB128
 * gets to ~2–3 bytes per cell** against 8 raw, and gzip on top lands R3's pessimistic
 * 147,782-cell case at ~300–450 KB. `02` §6.2 tabulates it at one year and at five.
 *
 * **Never ship JSON hex strings** (`05` §7.1, R4 §7.1) — roughly 2× the bytes and far
 * slower to parse. That is the alternative this file exists to refuse.
 *
 * ─── THREE OBJECTS, THREE MAGICS, ONE ENCODING ──────────────────────────────
 *
 *   `LSFG`  `explored-r10.<gen>.bin`          the set. Fetched at app load, always.
 *   `LSFL`  `explored-lastrun-r10.<gen>.bin`  u16 days, PARALLEL to the set. Fetched lazily.
 *   `LSFD`  `deltas/<from>-<to>.bin`          adds only. Fetched mid-session (§7.4).
 *
 * All three are little-endian, all three carry `version` and `res` in the same two bytes,
 * and all three are read by a decoder that **throws rather than guesses** when either is
 * unexpected. §6.4 is explicit about why: *"a silent mis-parse of cell ids looks like
 * territory teleporting, which is indistinguishable from data loss to the user."*
 *
 * ─── NO REMOVAL OPCODE, IN ANY OF THEM, EVER ────────────────────────────────
 *
 * D-020 makes the set append-only, and `05` §7.4 draws the security conclusion rather than
 * only the correctness one: *"a client that cannot express a removal cannot be tricked
 * into un-revealing ground by a malformed payload."* The structural argument, applied to
 * geometry — the same one `02` §4.7 makes about there being no un-award code path.
 *
 * ─── THIS FILE IS PURE ──────────────────────────────────────────────────────
 *
 * No S3, no clock, no gzip. `src/pipeline/explored-blob-store.ts` owns all three. The
 * client decodes these same functions in the browser (`0054`), which is the reason they
 * live in `src/domain` and import nothing that only exists in a Lambda.
 */

/** `version` byte. Bumped only when a decoder written for 1 could mis-read the bytes. */
export const BLOB_VERSION = 1

/** Magic numbers, ASCII, 4 bytes each. Distinct so a mis-routed object fails loudly. */
export const MAGIC_CELLS = "LSFG"
export const MAGIC_LASTRUN = "LSFL"
export const MAGIC_DELTA = "LSFD"

/**
 * `flags` bit 0 — the payload holds `h3.compactCells()` output, a MIXED-RESOLUTION array.
 *
 * **Specified so it can be turned on without a version bump, and deliberately not used.**
 * `05` §7.1 recommends shipping uncompacted for v1: compaction buys 3–10× on contiguous
 * territory (R3 §3.6), and 300–450 KB is already nothing, while mixed-resolution arrays
 * are the H3 correctness footgun `05` warns about twice. `02` §6.2 fixes the revisit
 * trigger at a payload past ~1 MB, which its own table puts past year ten of the case
 * that will not happen.
 *
 * **If it is ever set, the client MUST call `uncompactCells(arr, 10)` before any
 * membership test.** A `has()` against a compacted array silently answers "not explored"
 * for every cell whose parent is present, which reads as the map losing ground.
 */
export const FLAG_COMPACTED = 1

/** Byte offsets. Written out because three encoders and three decoders share them. */
const OFF_MAGIC = 0
const OFF_VERSION = 4
const OFF_RES = 5
const OFF_FLAGS = 6
const OFF_RESERVED = 7

/** `LSFG` / `LSFL`: generation at 8, count at 16. `LSFD` puts two generations there. */
const CELLS_HEADER_BYTES = 28
const LASTRUN_HEADER_BYTES = 20
const DELTA_HEADER_BYTES = 36

/**
 * An H3 index as the u64 it actually is. `8ad36070d777fff` → `625215327192973311n`.
 *
 * H3 ids ARE 64-bit integers; the string form is a hex rendering of one, and every id at
 * res 6 or 10 is exactly 15 hex characters. Sorting and delta-encoding are only cheap on
 * the integer, which is the whole basis of R3's size claim — neighbouring cells in one
 * locality differ in their LOW bits, and that is a fact about the number, not the string.
 */
export function cellToBig(cell: H3Index): bigint {
  return BigInt(`0x${cell}`)
}

/**
 * Back to the canonical lower-case hex string h3-js accepts.
 *
 * PADDED TO 15, which is defensive rather than necessary: every res-6 and res-10 id lands
 * on 15 characters already. It costs nothing and it means a future resolution whose ids
 * carry a leading zero nibble cannot produce a string h3-js silently rejects.
 */
export function bigToCell(value: bigint): H3Index {
  return value.toString(16).padStart(15, "0")
}

/** Thrown by every decoder in this file. One type, because callers do one thing: refuse. */
export class BlobFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BlobFormatError"
  }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * LEB128. Unsigned, little-endian base-128, 7 payload bits per byte.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The gaps between neighbouring sorted res-10 ids in one metro are small, so most encode
 * to one or two bytes. A varint is what turns "8 bytes per cell" into "~2–3" without any
 * dictionary, table or second pass — which matters because the decoder runs in the
 * browser on a mid-range Android (D-124) at app load.
 */

/** Appends `value` to `out`. `value` must be ≥ 0; the format has no sign bit. */
export function writeVarint(out: number[], value: bigint): void {
  if (value < 0n) throw new RangeError(`writeVarint: negative value ${value}`)
  let v = value
  while (v >= 0x80n) {
    out.push(Number((v & 0x7fn) | 0x80n))
    v >>= 7n
  }
  out.push(Number(v))
}

/**
 * Reads one varint at `at`. Returns the value and the offset just past it.
 *
 * **A truncated varint throws.** The continuation bit says "another byte follows"; if the
 * buffer ends first, the correct reading is that the object is corrupt, not that the value
 * is whatever the last complete byte said. Ten bytes is the ceiling for a u64 (7 × 10 =
 * 70 bits), and anything longer is refused rather than silently wrapped.
 */
export function readVarint(bytes: Uint8Array, at: number): { value: bigint; next: number } {
  let value = 0n
  let shift = 0n
  let i = at
  for (; i < bytes.length; i++) {
    const byte = bytes[i]!
    value |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value, next: i + 1 }
    shift += 7n
    if (shift > 63n) throw new BlobFormatError(`readVarint: varint at offset ${at} exceeds 64 bits`)
  }
  throw new BlobFormatError(
    `readVarint: truncated varint at offset ${at} (buffer ends at ${bytes.length})`,
  )
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * HEADERS. Shared by all three objects, because all three fail the same way.
 * ─────────────────────────────────────────────────────────────────────────────
 */

function writeHeader(view: DataView, bytes: Uint8Array, magic: string, flags: number): void {
  for (let i = 0; i < 4; i++) bytes[OFF_MAGIC + i] = magic.charCodeAt(i)
  view.setUint8(OFF_VERSION, BLOB_VERSION)
  view.setUint8(OFF_RES, RES)
  view.setUint8(OFF_FLAGS, flags)
  view.setUint8(OFF_RESERVED, 0)
}

/**
 * Validates magic, version and res, and returns `flags`.
 *
 * **`res !== 10` is a throw, not a warning** (D-115, `05` §7.1: *"a reader MUST reject
 * anything else"*). Cell ids at two resolutions are not comparable, not mergeable and not
 * renderable together; a decoder that accepted res 9 would produce a set that looks
 * plausible and is wrong everywhere. Same for an unknown `version`: `02` §6.4 requires the
 * client to *"discard its cache and refuse to render rather than guessing."*
 */
function readHeader(bytes: Uint8Array, magic: string, minBytes: number): number {
  if (bytes.length < minBytes) {
    throw new BlobFormatError(`${magic}: ${bytes.length} bytes is shorter than the ${minBytes}-byte header`)
  }
  const got = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)
  if (got !== magic) throw new BlobFormatError(`expected magic "${magic}", got "${got}"`)

  const version = bytes[OFF_VERSION]!
  if (version !== BLOB_VERSION) {
    throw new BlobFormatError(
      `${magic}: unknown version ${version} (this decoder reads ${BLOB_VERSION}). ` +
        "Refusing to guess — a mis-parse looks like territory teleporting (02 §6.4).",
    )
  }
  const res = bytes[OFF_RES]!
  if (res !== RES) {
    throw new BlobFormatError(
      `${magic}: res ${res}, expected ${RES} (D-115). Cell ids at two resolutions are not ` +
        "comparable; refusing to decode.",
    )
  }
  return bytes[OFF_FLAGS]!
}

/**
 * Every decoder rejects a payload whose flags it cannot honour. Today that is all of them
 * except 0: `FLAG_COMPACTED` needs an `uncompactCells` step no caller in this repo
 * performs yet, and the reserved bits have no meaning to assign.
 */
function assertFlags(magic: string, flags: number): void {
  if (flags === 0) return
  throw new BlobFormatError(
    `${magic}: flags ${flags} — this decoder handles only 0. bit0 (compacted) requires ` +
      "uncompactCells(arr, 10) before any membership test (05 §7.1); bits 1-7 are reserved.",
  )
}

/**
 * A `DataView` over exactly the bytes given, honouring `byteOffset`.
 *
 * `Buffer.from(...)` in Node hands back a view into a POOLED ArrayBuffer with a non-zero
 * `byteOffset`, so `new DataView(bytes.buffer)` reads whatever else the pool happens to
 * hold. Every decode here goes through this function for that reason.
 */
const viewOf = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * `LSFG` — the explored set.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface ExploredBlob {
  generation: number
  res: number
  flags: number
  /** Ascending, unique. `05` §7.1 decodes this to a `BigUint64Array` in the browser. */
  cells: bigint[]
}

/**
 * @param sorted     ASCENDING and UNIQUE. Not sorted here — the caller already holds a
 *                   sorted array (it merged into one), and a defensive `.sort()` on 150k
 *                   BigInts on the ingest hot path would be pure waste. Violations are
 *                   caught below rather than silently encoded, because a non-ascending
 *                   input produces negative gaps that this format cannot represent.
 * @param generation the monotonic per-user counter (I-11). Part of the object's own name.
 */
export function encodeExploredBlob(
  sorted: readonly bigint[],
  generation: number,
  flags = 0,
): Uint8Array {
  const deltas: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i]! - sorted[i - 1]!
    if (gap <= 0n) {
      throw new RangeError(
        `encodeExploredBlob: cells must be strictly ascending; index ${i} ` +
          `(${bigToCell(sorted[i]!)}) is not greater than index ${i - 1} ` +
          `(${bigToCell(sorted[i - 1]!)}).`,
      )
    }
    writeVarint(deltas, gap)
  }

  const bytes = new Uint8Array(CELLS_HEADER_BYTES + deltas.length)
  const view = viewOf(bytes)
  writeHeader(view, bytes, MAGIC_CELLS, flags)
  view.setBigUint64(8, BigInt(generation), true)
  view.setUint32(16, sorted.length, true)
  // `baseCell` is 0 for an empty set. The field is always present so the header is a
  // fixed size, and `count === 0` is what tells a decoder not to read it as a cell.
  view.setBigUint64(20, sorted[0] ?? 0n, true)
  bytes.set(deltas, CELLS_HEADER_BYTES)
  return bytes
}

export function decodeExploredBlob(bytes: Uint8Array): ExploredBlob {
  const flags = readHeader(bytes, MAGIC_CELLS, CELLS_HEADER_BYTES)
  assertFlags(MAGIC_CELLS, flags)
  const view = viewOf(bytes)

  const generation = Number(view.getBigUint64(8, true))
  const count = view.getUint32(16, true)
  const base = view.getBigUint64(20, true)

  if (count === 0) return { generation, res: RES, flags, cells: [] }

  const cells: bigint[] = new Array<bigint>(count)
  cells[0] = base
  let at = CELLS_HEADER_BYTES
  let prev = base
  for (let i = 1; i < count; i++) {
    const { value, next } = readVarint(bytes, at)
    // A zero gap would be a repeated id. The set is a `Set` upstream and cannot contain
    // one, so a zero here means corruption — and a decoder that accepted it would build a
    // cell array whose length disagreed with the manifest's `cellCount`.
    if (value === 0n) throw new BlobFormatError(`${MAGIC_CELLS}: zero gap at index ${i} (duplicate cell id)`)
    prev += value
    cells[i] = prev
    at = next
  }
  if (at !== bytes.length) {
    throw new BlobFormatError(
      `${MAGIC_CELLS}: ${bytes.length - at} trailing bytes after ${count} cells. ` +
        "A short count with a long body means the header and the payload disagree.",
    )
  }
  return { generation, res: RES, flags, cells }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * `LSFL` — the `lastRunDay` sidecar, parallel to the set.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * u16 days since 2020-01-01 (`02` T6's `lastRunDay`), one entry per cell, **in the cell
 * array's order**. `05` §7.2 keeps it as a separate object deliberately: it roughly
 * doubles the payload and **the fog does not need it**, because revealed is permanent
 * (D-020) and rendering depends on presence alone. Only the optional cold-territory
 * overlay (§8.5, D-133) reads it, so it is fetched lazily and never blocks first paint.
 *
 * ─── THE HEADER IS NOT IN `05` §7.2, AND IS ADDED HERE ON PURPOSE ───────────
 *
 * §7.2 describes this object as bare parallel u16s — its length implied by the cell
 * blob's `count`. That is exactly the shape whose failure mode is invisible: a client
 * holding cells for generation 41 that fetches lastrun for 42 gets an array off by
 * however many cells the run added, and every cold-territory verdict after the insertion
 * point is attributed to the wrong hexagon. Nothing errors; the overlay is just wrong.
 *
 * 20 bytes of header make that unrepresentable — the reader checks `generation` and
 * `count` against the set it already holds and refuses on a mismatch, which is the same
 * discipline §6.4 imposes on `version` and `res`. See D-219.
 */
export interface LastRunBlob {
  generation: number
  /** `u16` days since 2020-01-01, parallel to `ExploredBlob.cells`. */
  days: Uint16Array
}

/** The u16 ceiling. Day 65,535 is 2199-06-06, which is not a date anyone needs to plan for. */
export const MAX_LAST_RUN_DAY = 0xffff

export function encodeLastRunBlob(days: ArrayLike<number>, generation: number): Uint8Array {
  const bytes = new Uint8Array(LASTRUN_HEADER_BYTES + days.length * 2)
  const view = viewOf(bytes)
  writeHeader(view, bytes, MAGIC_LASTRUN, 0)
  view.setBigUint64(8, BigInt(generation), true)
  view.setUint32(16, days.length, true)
  for (let i = 0; i < days.length; i++) {
    const day = days[i]!
    if (!Number.isInteger(day) || day < 0 || day > MAX_LAST_RUN_DAY) {
      throw new RangeError(
        `encodeLastRunBlob: day ${day} at index ${i} is not a u16. lastRunDay counts days ` +
          "since 2020-01-01 (02 T6); a value outside 0..65535 means an unparsed or " +
          "pre-epoch timestamp reached the encoder.",
      )
    }
    view.setUint16(LASTRUN_HEADER_BYTES + i * 2, day, true)
  }
  return bytes
}

export function decodeLastRunBlob(bytes: Uint8Array): LastRunBlob {
  const flags = readHeader(bytes, MAGIC_LASTRUN, LASTRUN_HEADER_BYTES)
  assertFlags(MAGIC_LASTRUN, flags)
  const view = viewOf(bytes)

  const generation = Number(view.getBigUint64(8, true))
  const count = view.getUint32(16, true)
  const expected = LASTRUN_HEADER_BYTES + count * 2
  if (bytes.length !== expected) {
    throw new BlobFormatError(
      `${MAGIC_LASTRUN}: header claims ${count} days (${expected} bytes) but the object is ` +
        `${bytes.length}. The sidecar's length is the one thing that makes it parallel.`,
    )
  }
  const days = new Uint16Array(count)
  for (let i = 0; i < count; i++) days[i] = view.getUint16(LASTRUN_HEADER_BYTES + i * 2, true)
  return { generation, days }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * `LSFD` — the mid-session delta. `05` §7.4, `02` §6.5.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Typically 40–130 cells ≈ 100–350 bytes — smaller than the HTTP headers requesting it,
 * which is the point: the incremental path exists so the CLIENT'S WORK stays small (one
 * merge, one VBO upload, 1–2 invalidated res-6 buckets), not to save bandwidth.
 *
 * `0051` owns the contract this object is half of — the GC that keeps ~20 generations,
 * `manifest.deltasFrom`, and the client's `assert delta.fromGen === state.generation`.
 * This file owns the bytes, because §2.10's regeneration flow writes one on every bump.
 */
export interface DeltaBlob {
  fromGen: number
  toGen: number
  /** Ascending, unique. **Adds only** — there is no removal opcode and there must never be one. */
  added: bigint[]
}

export function encodeDeltaBlob(added: readonly bigint[], fromGen: number, toGen: number): Uint8Array {
  if (toGen <= fromGen) {
    throw new RangeError(`encodeDeltaBlob: toGen ${toGen} must be greater than fromGen ${fromGen} (I-11)`)
  }
  const deltas: number[] = []
  for (let i = 1; i < added.length; i++) {
    const gap = added[i]! - added[i - 1]!
    if (gap <= 0n) throw new RangeError(`encodeDeltaBlob: added cells must be strictly ascending at index ${i}`)
    writeVarint(deltas, gap)
  }

  const bytes = new Uint8Array(DELTA_HEADER_BYTES + deltas.length)
  const view = viewOf(bytes)
  writeHeader(view, bytes, MAGIC_DELTA, 0)
  view.setBigUint64(8, BigInt(fromGen), true)
  view.setBigUint64(16, BigInt(toGen), true)
  view.setUint32(24, added.length, true)
  view.setBigUint64(28, added[0] ?? 0n, true)
  bytes.set(deltas, DELTA_HEADER_BYTES)
  return bytes
}

export function decodeDeltaBlob(bytes: Uint8Array): DeltaBlob {
  const flags = readHeader(bytes, MAGIC_DELTA, DELTA_HEADER_BYTES)
  assertFlags(MAGIC_DELTA, flags)
  const view = viewOf(bytes)

  const fromGen = Number(view.getBigUint64(8, true))
  const toGen = Number(view.getBigUint64(16, true))
  const count = view.getUint32(24, true)
  const base = view.getBigUint64(28, true)

  if (count === 0) {
    if (bytes.length !== DELTA_HEADER_BYTES) {
      throw new BlobFormatError(`${MAGIC_DELTA}: addedCount 0 but ${bytes.length - DELTA_HEADER_BYTES} body bytes`)
    }
    return { fromGen, toGen, added: [] }
  }

  const added: bigint[] = new Array<bigint>(count)
  added[0] = base
  let at = DELTA_HEADER_BYTES
  let prev = base
  for (let i = 1; i < count; i++) {
    const { value, next } = readVarint(bytes, at)
    if (value === 0n) throw new BlobFormatError(`${MAGIC_DELTA}: zero gap at index ${i} (duplicate cell id)`)
    prev += value
    added[i] = prev
    at = next
  }
  if (at !== bytes.length) {
    throw new BlobFormatError(`${MAGIC_DELTA}: ${bytes.length - at} trailing bytes after ${count} cells`)
  }
  return { fromGen, toGen, added }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MERGE. §2.10 step 3 — *"merge the run's newly-added cells (still sorted)"*.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The operation the whole regeneration path is built around: a sorted 20k–150k array plus
 * 40–130 touched cells, in one linear pass, producing a new sorted array and — the part
 * the delta object needs — **exactly which of them were not already there**.
 *
 * The two outputs come from one walk rather than a merge followed by a set difference,
 * because the difference is free at the moment the comparison is made and costs another
 * 150k-element pass afterwards.
 *
 * `touched` may repeat and need not be sorted; it is sorted and de-duplicated here. It
 * arrives from the classifier as one activity's cells and is small, so the sort is
 * ~130 log 130 against a 150k linear merge — not worth pushing onto the caller.
 */
export interface MergeResult {
  /** The new set, ascending and unique. */
  cells: bigint[]
  /** The subset of `touched` that `base` did not already hold. Ascending. */
  added: bigint[]
  /** For each output position, the index it came from in `base`, or -1 when it is new. */
  fromBase: Int32Array
}

export function mergeCells(base: readonly bigint[], touched: Iterable<bigint>): MergeResult {
  const incoming = [...new Set(touched)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  const cells: bigint[] = []
  const added: bigint[] = []
  const fromBase = new Int32Array(base.length + incoming.length)

  let i = 0
  let j = 0
  while (i < base.length || j < incoming.length) {
    const b = i < base.length ? base[i]! : undefined
    const n = j < incoming.length ? incoming[j]! : undefined

    if (n === undefined || (b !== undefined && b < n)) {
      fromBase[cells.length] = i
      cells.push(b!)
      i++
    } else if (b === undefined || n < b) {
      fromBase[cells.length] = -1
      cells.push(n!)
      added.push(n!)
      j++
    } else {
      // Equal: the cell is already explored. It stays, carrying its base index so the
      // sidecar keeps its old day unless this activity advanced it.
      fromBase[cells.length] = i
      cells.push(b!)
      i++
      j++
    }
  }

  return { cells, added, fromBase: fromBase.subarray(0, cells.length) }
}

/**
 * The sidecar's merge, driven by the cell merge's `fromBase` so the two arrays cannot
 * drift apart. An output slot either copies the day it had (`fromBase[i] >= 0`) or starts
 * at `dayFor` (a cell this activity discovered).
 *
 * **`max`, never a plain assignment**, for the reason `explored-cells.ts` gives about
 * `lastRunAt`: activities arrive out of order, and a 2024 backfill must not lower a day
 * written by a 2026 run. That is the same rule T6's `ConditionExpression` enforces in
 * DynamoDB, expressed here over the array, so the blob agrees with the table without
 * having to read it.
 */
export function mergeLastRunDays(
  baseDays: ArrayLike<number>,
  merge: MergeResult,
  touched: ReadonlySet<bigint>,
  day: number,
): Uint16Array {
  const out = new Uint16Array(merge.cells.length)
  for (let i = 0; i < merge.cells.length; i++) {
    const from = merge.fromBase[i]!
    const prior = from >= 0 ? (baseDays[from] ?? 0) : 0
    out[i] = touched.has(merge.cells[i]!) ? Math.max(prior, day) : prior
  }
  return out
}
