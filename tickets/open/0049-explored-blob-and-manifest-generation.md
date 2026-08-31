---
id: 49
slug: explored-blob-and-manifest-generation
title: explored-r10.bin generation, aggregates, and the manifest generation counter
type: feature
priority: high
status: open
size: m
capability: 07-fog-projection-and-cells
depends_on: [47]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The write half of the client delivery path (`05-fog-of-war.md` §7.1, `02-data-model.md` §6). After
each ingest, the Lambda produces the objects the browser downloads.

Format — little-endian, served with `Content-Encoding: gzip`:

```
offset size field
0      4    magic "LSFG"
4      1    version = 1
5      1    res = 10           (D-115; a reader MUST reject anything else)
6      1    flags  bit0 = compacted, bits 1..7 reserved (0)
7      1    reserved = 0
8      8    generation u64, monotonic
16     4    count u32
20     8    baseCell u64 (smallest H3 id)
28     ..   (count-1) LEB128 unsigned varints, ascending gaps
```

Sorted + delta + LEB128 works because neighbouring res-10 ids in one locality differ only in their
low bits — most deltas fit in 1–2 bytes, and gzip lands the pessimistic five-year case at
~300–450 KB. **Ship uncompacted for v1** (flags bit0 = 0). 300–450 KB is already fine, and
mixed-resolution arrays are the H3 footgun this project warns about twice.

Companion objects: `explored-agg.<gen>.json` (res 6/7/8 parent → `{exploredChildren,
totalChildren, fraction}`, a few KB, powers zoom-out opacity in 0058) and
`explored-lastrun-r10.<gen>.bin` (u16 days-since-2020-01-01, **parallel to the cell array, same
order**). `lastRunAt` is deliberately a separate object: it roughly doubles the payload and the fog
does not need it, because revealed is permanent (D-020) and rendering depends on presence alone.

**Regeneration does not re-read the table** (`02-data-model.md` §2.10). The naive full-partition
`Query` is ~3,000 RRU per run; instead:

```
GET explored-r10.<gen-1>.bin → decode → merge the run's 40–130 new cells (still sorted)
→ encode, gzip, PUT explored-r10.<gen>.bin + deltas/<gen-1>-<gen>.bin → PUT manifest.json
```

Under 100 ms at the five-year worst case. The full-table `Query` path stays in the codebase as
AP-17, the **repair** path, invoked by the rebuild drill and a consistency check — never on the
ingest hot path.

`generation` is monotonic per user, never decreasing and never restarting at 1, including after a
full rebuild (I-11). It is mirrored to `Profile.exploredGeneration` purely as a notification
channel for the AppSync subscription; **the manifest is authoritative** and the mirror is repaired
if they disagree.

## Acceptance criteria

- [ ] `encodeExploredBlob(sortedCells, generation)` and `decodeExploredBlob(bytes)` round-trip a
      150k-cell fixture to the exact same set, in the same order.
- [ ] Header fields are exactly as above; a decoder given `res !== 10` or an unknown `version`
      throws rather than guessing.
- [ ] `explored-agg.<gen>.json` fractions match a brute-force count over the cell set.
- [ ] `explored-lastrun-r10.<gen>.bin` is index-parallel to the cell array; a test asserts entry
      *i* corresponds to cell *i* for a shuffled-then-sorted fixture.
- [ ] Regeneration reads the previous generation's blob from S3 and merges, issuing **zero** T6
      `Query` calls on the hot path (asserted with a stubbed DynamoDB client).
- [ ] AP-17 full-table rebuild exists, produces an identical blob to the incremental path for the
      same data, and is not called by `process-activity`.
- [ ] `generation` is bumped by a conditional update and is proven monotonic by a test that
      attempts to lower it.
- [ ] Blob and delta objects are written with
      `Cache-Control: public, max-age=31536000, immutable`; `manifest.json` with `no-cache`.
- [ ] A 40-run fixture produces a blob whose gzipped size is within the documented band.

## Notes

Never ship JSON hex strings — roughly 2× the bytes and far slower to parse.

Compaction (`flags` bit0 + `h3.compactCells`) is specified in the format so it can be turned on
without a version bump, but it is a lever for later. If it is ever enabled, the client MUST call
`uncompactCells(arr, 10)` before any membership test.

## Operator validation

1. Sync a run. In the S3 console, `users/<uid>/explored/` gains a new `explored-r10.<gen>.bin`
   whose `<gen>` is one higher than the previous, and the old file is still there.
2. Open `manifest.json` in the browser — `generation`, `cellCount` and `updatedAt` reflect the run
   you just imported.
3. Note the blob's size. After a run over entirely known ground, the new blob should be within a
   few bytes of the previous one.
