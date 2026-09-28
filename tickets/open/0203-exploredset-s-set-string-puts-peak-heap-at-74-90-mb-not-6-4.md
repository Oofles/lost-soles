---
id: 203
slug: exploredset-s-set-string-puts-peak-heap-at-74-90-mb-not-6-4
title: ExploredSet's Set<string> puts peak heap at 74-90 MB, not §6.4's low tens
type: bug
priority: med
status: open
size: m
capability: 08-map-and-fog-renderer
depends_on: []
blocked_by: []
source: agent
created: 2026-09-11T14:02:46Z
started: 2026-09-28T14:14:20Z
---

## Description

§6.4 item 7: *"Peak JS heap with a synthetic 500k-cell dataset. Assertion: the `BigUint64Array` plus
buckets stays in the **low tens of MB**."*

Measured by `0059`'s harness, one Chromium process per dataset so the baseline is clean
(`--enable-precise-memory-info`, baseline 39.3 MB in every run):

| dataset | cells | peak heap over baseline |
|---|---|---|
| 50k | 49,537 | **32.8 MB** — passes |
| 150k | 151,201 | **73.7 MB** |
| 500k | 500,617 | **90.3 MB** |

So the assertion holds at today's volumes and fails from roughly year one.

The `BigUint64Array` is not the cost — 500k cells is 4 MB of it. `ExploredSet` keeps a **second**
representation for membership:

```ts
#cells: BigUint64Array      // 4 MB at 500k
#members: Set<string>       // 500k 15-character h3 id strings
```

A `Set` of half a million short strings is tens of megabytes of string objects plus entry overhead,
and `fromBlob` additionally builds a transient `bigint[]` of the same length before
`BigUint64Array.from` copies it — boxed bigints, one heap object each, which inflates the *peak*
specifically.

**§6.3 already names the exit**, and `explored-set.ts`'s own comment on `has()` points at it:

> *"O(1) today, a 17-comparison binary search if §6.3's exit is ever taken."*

The sorted `BigUint64Array` is already there. A binary search over it removes the `Set` entirely and
makes `has()` ~19 comparisons at 500k, which is nothing on the paths that call it.

## Acceptance criteria

- [x] ~~Peak~~ **Retained** JS heap over baseline is in the low tens of MB at 500,617 cells.
      *Amended by D-247 — see Resolution. Retained 15.2 MB; pre-GC peak 64.3 MB, reported unjudged.*
- [x] `has()` is a binary search over `#cells`, or the memory is reduced another way and §6.4 is
      amended to say what the real figure is and why.
- [x] `fromBlob` does not hold a boxed `bigint[]` of every cell at its peak.
- [x] `explored-set.test.ts` still proves membership, ordering and `applyDelta` unchanged.
- [x] `node tools/fog-harness/run-perf.mjs 500k` exits 0 on item 7.

## Steps to reproduce

1. `node tools/fog-harness/run-perf.mjs 500k`
2. Read item 7.

## Expected vs actual

**Expected:** low tens of MB at 500k cells.

**Actual:** 90.3 MB at 500k, 73.7 MB at 151k.

## Notes

Priority is medium rather than high on the ticket's own reasoning: §6.4 says *"real data will not
reach 500k for years (R3 §2)"*, and 50k — roughly where the operator is — passes comfortably. What
makes it worth fixing before then is that the phone is the constrained device and a tab that is
evicted under memory pressure comes back through the context-loss rebuild path, which is a visible
cost rather than a silent one.

Check the **decode peak** separately from the steady state when this is worked: the two have
different fixes and `0059`'s harness reports only the peak.

## Resolution

**`ExploredSet` is one representation now.** §6.3's recorded exit was taken: `#members: Set<string>`
is gone and `has()` is a binary search over `#cells` (a non-hex string answers `false`, as the `Set`
did, rather than throwing out of `cellToBig`). `fromCells` now does no work, so the warm start does
no per-cell work at all. `fromBlob` decodes straight into a `BigUint64Array` through a new
`decodeExploredBlobTyped` in `src/domain/explored-blob.ts`. It shares its loop with
`decodeExploredBlob` through a generic `decodeCells`, so the result and every refusal are identical.
The ingest path keeps the `bigint[]` decoder because `mergeCells` works on one. `lib/fog/decode.ts`'s
counting seam now wraps the typed decoder.

**That was not enough, and the reasons were in the measurement.** With the `Set` gone, 500k went
from 99.4 MB to 58.7 MB, but 150k read 72.3 MB, higher than 500k. A figure that doesn't rise with
dataset size is being set by GC timing, not by the fog. Two things were inflating it:

1. **The harness measured itself.** `perf-harness.js` generated its fixture in-page *after* item 7's
   baseline: 500k `gridDisk` strings plus a sorted `bigint[]`. `run-perf.mjs` now writes one page per
   dataset with the checked-in `public/fog-fixtures/fog-<label>.bin` inlined as base64, decoded
   before `perf.start()`. `fixtures.test.ts` already asserts those bytes equal `syntheticBlob`'s.
   Afterwards: 16.4 / 26.6 / 59.7 MB, rising with size as it should, with 500k still failing.
2. **The pre-GC peak is mostly garbage the fog doesn't keep.** Per-phase heap samples showed the jump
   during the z13→z12 sweep (res-10/9 bucket derivation) and the heap falling *below the baseline*
   once V8 collected at the end. With `--expose-gc` and a forced collection while everything was
   still referenced, the fog retains **6.4 / 9.4 / 15.2 MB**.

**Widened, with the operator's agreement:** first I thought the transient came from
`cellToParent(bigToCell(cell))` in `zoom-buckets.ts#materialiseIds` (two strings per cell per coarse
resolution), so that now works on the id's two 32-bit words through a `Uint32Array` view
(`parentWords`/`wordsToCell`), allocating one string per parent rather than per cell. The worst
bucket derivation at 500k went from **152 ms to 20 ms** (§6.4 item 5). **It did not move the heap
peak**, so my first diagnosis was wrong. The remaining garbage comes from the per-id projection and
bridge passes (`cellToLatLng`, `gridDisk`), which are h3-js APIs that return strings and arrays.
The change stays in because of the derivation speed-up, and a test pins it to `cellToParent` for
every cell of three discs plus pentagon neighbourhoods at every resolution from 0 to 11.

**D-247 (operator's decision): item 7 is judged on retained heap.** Other options offered were
raising the ceiling to the ~65 MB peak, or blocking on reimplementing H3 traversal to avoid the
per-id allocations. `PerfHost.collectGarbage` is optional; the collector collects before its
baseline and `FogPerf.settle()` collects after the path. Item 7's row is renamed
`retained JS heap over baseline`, prints the pre-GC peak alongside it unjudged, and is **unjudged
(never peak-judged)** wherever `gc` does not exist, which includes the phone's `?fog=debug`.
Criterion 1 was amended to match; "peak" is struck through, not deleted. `05` §6.4 item 7 and §7.1
and `02` §6.3 are amended.

**The decode peak vs steady state**, as the Notes asked: `fromBlob` at 500k moves the heap by
~9 MB, including transient varint `bigint`s, against a 4 MB array. The first cull at z14 (res-11 ids
for visible groups) adds ~14 MB before GC. Retained after the whole path is 15.2 MB.

Files: `lib/fog/explored-set.ts`, `lib/fog/decode.ts`, `src/domain/explored-blob.ts`,
`lib/fog/zoom-buckets.ts`, `lib/fog/perf/collector.ts`, `lib/fog/perf/report.ts`,
`tools/fog-harness/perf-harness.js`, `tools/fog-harness/run-perf.mjs`; tests in
`explored-set.test.ts` (binary-search edges, empty set, non-id input, post-delta membership),
`explored-blob.test.ts` (typed decoder parity, including every refusal), `zoom-buckets.test.ts`
(`wordParent` ≡ `cellToParent`), `collector.test.ts` and `report.test.ts` (retained vs peak).
Docs: `05-fog-of-war.md` §6.4/§7.1, `02-data-model.md` §6.3, D-247.

## Operator validation

No perceptual check: nothing visible changed. The fog draws the same cells, since `wordParent` is
proven identical to `cellToParent`, and the operator was not asked to look at anything.

Smoke test, run by the agent 2026-09-28 on this machine (headless Chromium 153, SwiftShader):
`node tools/fog-harness/run-perf.mjs` → **exit 0**, `PERF HARNESS PASS` at all three sizes.

| dataset | retained over baseline | pre-GC peak over baseline |
|---|---|---|
| 50k | 6.4 MB | 18.2 MB |
| 150k | 9.4 MB | 22.8 MB |
| 500k | 15.2 MB | 64.3 MB |

The cross-dataset canary passes (z13+ counts identical at 50k/150k/500k). Full suite: 118 files,
2,138 passed / 1 skipped; `tsc --noEmit` and eslint clean.
