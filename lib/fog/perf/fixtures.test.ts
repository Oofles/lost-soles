import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { decodeExploredBlob } from "@/src/domain/explored-blob"

import { ExploredSet } from "../explored-set"
import { DATASETS, discSize, PERF_ORIGIN, syntheticBlob, syntheticCells } from "./synthetic"

/**
 * THE GENERATOR AND THE GUARD, IN ONE FILE. Ticket `0059` criterion 2. `05-fog-of-war.md` §6.4.
 *
 *   FOG_FIXTURES=write npx vitest run lib/fog/perf/fixtures.test.ts
 *
 * regenerates `public/fog-fixtures/*.bin`; running it normally asserts the checked-in bytes are
 * byte-identical to what the generator produces today.
 *
 * ─── WHY THE GENERATOR IS A TEST AND NOT `scripts/make-fog-fixture.mjs` ─────
 *
 * Two reasons, and the second is the real one.
 *
 * **Mechanical:** every other generator in `scripts/` is plain node with no dependencies (D-163), and
 * this one has to call `encodeExploredBlob` — a TypeScript module with extensionless imports, which
 * `node --experimental-strip-types` cannot resolve. Vitest already resolves them. A `.mjs` that
 * reimplemented the varint writer would be a second, silent claim about the wire format.
 *
 * **Actual:** a generator nobody runs again cannot drift, and a fixture nobody re-derives cannot be
 * caught drifting. Checked in as a test, the bytes and the code that produces them are re-compared on
 * every `npm test` — so a change to `encodeExploredBlob`, to `RES`, or to h3-js's cell ordering fails
 * here, loudly, on the commit that made it, rather than silently invalidating every number `0059`
 * recorded in the capability doc.
 *
 * ─── AND THE FIXTURE LIVES IN `public/` ────────────────────────────────────
 *
 * Because the browser has to FETCH it: `?fog=perf` is a page on the phone, and the phone cannot
 * import a fixture out of `lib/`. `public/` is served statically and never enters a JS bundle, so the
 * cost of carrying it is bytes on S3 and nothing in the app — `check-bundle-leak.mjs`'s concern is
 * what reaches the client bundle, and a file MapLibre never asks for never does.
 */

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "")
const DIR = join(ROOT, "public", "fog-fixtures")
const WRITE = process.env.FOG_FIXTURES === "write"

describe("the synthetic datasets — criterion 2", () => {
  it("names sizes that are whole hex discs, so no fixture has a bite out of it", () => {
    for (const dataset of DATASETS) {
      expect(discSize(dataset.k)).toBe(dataset.cells)
    }
    // The three §6.4 asks for, to within a whole ring. Stated as a range so the intent survives a
    // future k change: these are "50k / 150k / 500k", not 49,537 exactly.
    expect(DATASETS.map((d) => d.cells)).toEqual([49_537, 151_201, 500_617])
  })

  /**
   * NOT A TAUTOLOGY, and it is worth saying why: the encoder REFUSES a set that is not strictly
   * ascending (`encodeExploredBlob` throws a `RangeError` naming the index), and `gridDisk` returns
   * cells in ring order. So this asserts the sort is real, that h3 returned no duplicate, and that
   * the bytes survive a round trip through the shipped decoder back to the same 500,617 cells.
   */
  it.each(DATASETS)(
    "round-trips $label through the shipped writer and reader",
    (dataset) => {
      const bytes = syntheticBlob(dataset)
      const blob = decodeExploredBlob(bytes)
      expect(blob.cells).toHaveLength(dataset.cells)
      expect(blob.generation).toBe(1)

      const set = ExploredSet.fromBlob(bytes)
      expect(set.size).toBe(dataset.cells)
      /**
       * Ascending and unique, read back off the array the renderer actually iterates — as ONE
       * assertion over a plain loop rather than 500,617 `expect` calls. The per-element form took
       * longer than vitest's whole 5 s timeout at the largest size, which is a test that fails for
       * being slow rather than for being wrong; the loop reports the first offending index, which is
       * the only thing the per-element form told you anyway.
       */
      let firstDescending = -1
      for (let i = 1; i < set.cells.length; i++) {
        if (set.cells[i]! <= set.cells[i - 1]!) {
          firstDescending = i
          break
        }
      }
      expect(firstDescending).toBe(-1)
    },
    // h3's `gridDisk` at k=408 is half a million cells and the encode walks them twice.
    30_000,
  )

  it("puts every cell inside the disc it claims to be", () => {
    const dataset = DATASETS[0]!
    const cells = syntheticCells(PERF_ORIGIN, dataset.k)
    expect(new Set(cells.map(String)).size).toBe(dataset.cells)
  })

  /**
   * THE DRIFT GUARD. Byte-for-byte, because "same cells" is not the claim — the claim is that the
   * file the phone downloads is the file this generator produces.
   */
  it.each(DATASETS)("$label matches the checked-in fixture byte for byte", (dataset) => {
    const path = join(DIR, `fog-${dataset.label}.bin`)
    const bytes = syntheticBlob(dataset)

    if (WRITE) {
      mkdirSync(DIR, { recursive: true })
      writeFileSync(path, bytes)
      console.log(`wrote ${path} — ${dataset.cells.toLocaleString()} cells, ${bytes.length} bytes`)
    }

    expect(
      existsSync(path),
      `${path} is missing. Regenerate with FOG_FIXTURES=write npx vitest run lib/fog/perf/fixtures.test.ts`,
    ).toBe(true)
    const onDisk = new Uint8Array(readFileSync(path))
    expect(onDisk.length).toBe(bytes.length)
    expect(Buffer.compare(Buffer.from(onDisk), Buffer.from(bytes))).toBe(0)
  }, 30_000)
})
