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
started: 2026-09-08T13:28:29Z
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

- [x] `encodeExploredBlob(sortedCells, generation)` and `decodeExploredBlob(bytes)` round-trip a
      150k-cell fixture to the exact same set, in the same order.
      *`gridDisk(ORIGIN, 225)` = 152,551 cells, above R3's 147,782 worst case.*
- [x] Header fields are exactly as above; a decoder given `res !== 10` or an unknown `version`
      throws rather than guessing. *Also: wrong magic, `flags` this decoder cannot honour,
      trailing bytes, a truncated varint, a zero gap, and a pooled `Buffer` byteOffset.*
- [x] `explored-agg.<gen>.json` fractions match a brute-force count over the cell set.
- [x] `explored-lastrun-r10.<gen>.bin` is index-parallel to the cell array; a test asserts entry
      *i* corresponds to cell *i*.
      **Amended** — *"for a shuffled-then-sorted fixture"* was dropped. The sidecar is never built
      from a shuffle: it is produced by `mergeLastRunDays`, driven by the cell merge's `fromBase`
      map, so the two arrays cannot drift by construction. The tests exercise what can actually
      go wrong instead — new cells landing in the MIDDLE of the array, re-run ground advancing
      while its neighbours do not, and a backfill that must not lower a day. `rebuildFromTable`
      does sort, and its test asserts parallelism after that sort.
- [x] Regeneration reads the previous generation's blob from S3 and merges, issuing **zero** T6
      `Query` calls on the hot path (asserted with a stubbed DynamoDB client).
      *Stronger than asked: the stub refuses every command that is not the counter's
      `ADD generation :one`, so a `GetItem`, `Scan` or `BatchGetItem` would fail it too.*
- [x] AP-17 full-table rebuild exists, produces an identical blob to the incremental path for the
      same data, and is not called by `process-activity`.
      *Byte-identical, proven twice: in `explored-rebuild.test.ts` against a fake driven by the
      shipped writers, and LIVE against real DynamoDB and real S3 for a three-run history
      ingested and published in lockstep. "Not called" is enforced structurally — see below.*
- [x] `generation` is bumped by a conditional update and is proven monotonic by a test that
      attempts to lower it.
      **Amended** — the ingest bump is `ADD generation :one`, which is monotonic *by
      construction* rather than by condition: the increment happens inside DynamoDB, so there is
      no value a caller could pass that lowers it and no read to race. A conditional form exists
      and is tested exactly as asked — `raiseGenerationTo`, the drill's §8.3 step 7 — and
      refuses to lower, refuses an equal value, and leaves the counter untouched when it does.
      20 concurrent live bumps returned 20 distinct numbers.
- [x] Blob and delta objects are written with
      `Cache-Control: public, max-age=31536000, immutable`; `manifest.json` with `no-cache`.
      *Asserted in the unit tests and read back off real S3 objects in the smoke run.*
- [x] A 40-run fixture produces a blob whose gzipped size is within the documented band.
      **Amended** — `02` §6.2's table has no row for a 40-run set; its smallest is "1 year,
      realistic, ~8,000-15,000 cells". The documented number a 40-run fixture *can* test is the
      per-cell one the whole size argument rests on — `05` §7 and `02` §6.2's *"~2-3 bytes per
      cell"* — so that is what is asserted, plus §6.2's own claim that gzip never costs more
      than the varints it compresses. Measured: **3.01 bytes/cell** across 753 cells from 40
      runs, and **3.00 bytes/cell** at the 152,551-cell five-year size (447.5 KB of varints).

## Notes

Never ship JSON hex strings — roughly 2× the bytes and far slower to parse.

Compaction (`flags` bit0 + `h3.compactCells`) is specified in the format so it can be turned on
without a version bump, but it is a lever for later. If it is ever enabled, the client MUST call
`uncompactCells(arr, 10)` before any membership test.

### What the ticket's author asked for (kept as context, answered in `## Operator validation` below)

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

1. Sync a run. In the S3 console, `users/<uid>/explored/` gains a new `explored-r10.<gen>.bin`
   whose `<gen>` is one higher than the previous, and the old file is still there.
2. Open `manifest.json` in the browser — `generation`, `cellCount` and `updatedAt` reflect the run
   you just imported.
3. Note the blob's size. After a run over entirely known ground, the new blob should be within a
   few bytes of the previous one.

## Resolution

The delivery layer, end to end: three binary formats, the aggregate, the incremental publish, the
AP-17 repair path, and the counter that names all of it.

### The design named a mechanism that no longer exists

`05` §7.3 and `02` §6.4 both say `generation` is *"bumped by the ingest Lambda inside the same
transaction as the cell writes"*. **D-144/I-10 deleted that transaction** — a run produces 40-130
cells against `TransactWriteItems`' 100-item cap, so the cell writes moved out entirely. The same
shape of staleness as AP-15 in `0048`, and found the same way: by trying to implement it.

The obvious replacement is unsafe, and not theoretically. Reading `manifest.generation` and adding
one is a read-modify-write, and the ingest queue is a standard SQS queue with `batchSize: 1` and
no reserved concurrency — a Sync that pulls five activities runs five workers for one user. Two
read 41, both write `explored-r10.42.bin`: two different cell sets under one name, served
`Cache-Control: immutable`. Nothing recovers from that, because `immutable` is a promise the CDN
and the browser have already believed.

**Operator chose the counter item** (`U#<uid>#GEN`, a third item type in T6). Recorded as
**D-218**; `02` T6 and §6.4 and `05` §7.3 amended.

### Which exposed a second hole the counter does not close

A unique generation stops two workers writing the same *filename*. It does not stop them merging
from the same *base*: A publishes 42 = blob41 + runA, B publishes 43 = blob41 + runB, and runA's
cells are gone from 43 and from everything after it. T6 still holds them — this is not a re-fog,
D-020 holds — but the payload has silently lost ground until an AP-17 repair.

So the manifest PUT carries `IfMatch` on the ETag its base was read from (`IfNoneMatch: "*"` on a
first publish). The loser takes a 412, discards its work and re-merges against the winner. This is
also *why the allocator is a counter and not "manifest + 1"*: the loser's blob 43 is an orphan —
`02` §6.4 already calls orphan blobs harmless — and a counter guarantees no later run writes
**different** bytes to that same immutable name. **D-219**, with the sidecar header below.

### Files

**New, `src/domain` (pure — the browser decodes these same functions in `0054`):**

- `explored-blob.ts` — LEB128, the three formats (`LSFG` set, `LSFL` sidecar, `LSFD` delta),
  `mergeCells` and `mergeLastRunDays`. Every decoder throws on `res !== 10`, an unknown `version`,
  a flag it cannot honour, a zero gap or trailing bytes: `02` §6.4 requires the client to *"discard
  its cache and refuse to render rather than guessing"*, because a mis-parse looks like territory
  teleporting. `mergeCells` returns the merged set, the adds, **and** a `fromBase` index map, all
  from one walk — the difference is free at the comparison and costs another 150k pass afterwards.
- `explored-agg.ts` — `computeAgg` rolls res-7 up from res-8 and res-6 up from res-7 rather than
  calling `cellToParent` three times per cell: 152k calls plus a few thousand, not 456k. The test
  brute-forces all three levels independently, so the transitivity that optimisation rests on is
  asserted rather than assumed.

**New, `src/pipeline`:**

- `explored-generation.ts` — `bumpGeneration` (`ADD`, `UPDATED_NEW`) and `raiseGenerationTo`
  (conditional, for the drill). No `GetItem`: nothing ever reads the counter back, because the
  previous generation comes from the manifest, which `02` §6.4 makes authoritative.
- `explored-blob-store.ts` — §2.10's flow, the manifest CAS, the retry, and the S3 keys.
- `explored-rebuild.ts` — AP-16/AP-17, `Query AGG#6` then `Query` per parent, paginated.

**Modified:** `explored-cells.ts` gained `writeAggregates` (T6 item type B); `process-activity.ts`
gained a `blobs` phase and `blobsMs`; the handler passes `USER_DATA_BUCKET`; `backend.ts` adds the
`users/*` S3 statement and the env var.

### Where the phase sits, and why

`cells` → **`blobs`** → `persist`. Above the transaction, for the same reason the cell writes are.
Below it, a publish failure would leave a `DONE` receipt with the activity's cells in T6 and in no
blob — and the next run merges from the last *published* generation, so those cells would be
absent from every generation after it, permanently, until an AP-17 repair. Above it, the receipt
is still `PROCESSING` and a redelivery re-merges the same cell set. The same skew D-144 chose:
**map ahead of XP, never the reverse.** `process-activity.test.ts` asserts a failed publish throws
with `persist` never reached.

A traceless activity publishes nothing and bumps no generation — tickets `0069` and `0159` state
that as their own criterion, and it is not an optimisation: a bump makes every cached client
refetch a 300 KB blob byte-identical to the one it holds.

### AP-17 exists and the worker cannot reach it

`02` §5.6: *"AP-16 is the repair path. **Calling it from `process-activity` is a review-blocking
bug.**"* Two independent mechanisms, because a build gate can be skipped and a missing IAM action
cannot:

- **`scripts/check-fog-hot-path.mjs`** — a TRANSITIVE import walk from both entry points (the
  pipeline module and the handler), because a grep is satisfied by moving the import one file
  away, which is exactly how a hot path acquires an expensive dependency in practice. Type-only
  and dynamic imports count; prose naming the module does not. 7 self-test cases; wired into
  `gate.yml` and `amplify.yml`.
- **No `dynamodb:Query` on T6.** `0048` left the grant off and its test said the action was
  *"0049's to justify"*. **0049 built the rebuild and still did not add it** — the repair path
  takes its `Query` when it gets an execution context of its own (the drill, `0105`), where the
  ~1,000-3,000 RRU is a cost someone chose rather than one the worker inherited. The synth test
  now asserts the worker's T6 actions are *exactly* `BatchGetItem` + `UpdateItem`, which also
  pins the claim that the counter and the aggregates needed no new permission.

### Two doc divergences, resolved per D-153

- **`02` T6 said "two item types share this table"**, justified by a shared `TransactWriteItems`
  that D-144 removed. Now three, justified by the shared writer.
- **`05` §7.2 described the sidecar as bare parallel u16s.** That shape's failure is invisible: a
  client holding cells for generation 41 that fetches the sidecar for 42 is off by however many
  cells the run added, and every cold-territory verdict past the insertion point lands on the
  wrong hexagon with nothing erroring. It now carries a 20-byte header (`LSFL`, version, res,
  generation, count) and the reader refuses a mismatch. A sidecar that does not decode is
  *dropped*, not thrown — it feeds one optional overlay, and failing an ingest over it would block
  the map to protect a cosmetic layer — and reported as `sidecarRebuilt` rather than swallowed.

### Measurements

| | |
|---|---|
| 152,551-cell set (R3's 5-year pessimistic is 147,782) | 447.5 KB of varints, **3.00 bytes/cell** |
| 40-run fixture, 753 cells | 2,266 bytes, **3.01 bytes/cell** |
| `explored-agg.json` at 152,551 cells | 279 KB raw, **12.8 KB gzipped** |
| res-6 parents at that size | **85** — inside `02` T6's *"~20-60 home metro, ~100-200 with travel"* |
| res-8 parents | 3,233 |

`05` §7.2 calls the aggregate *"a few KB"*. It is 12.8 KB on the wire, which is more than "a few"
and still noise beside the set it accompanies; §7.2 was left as written, because the number that
matters is the one that crosses the network. Left undone deliberately: `FLAG_COMPACTED` is
specified and refused by every decoder — `05` §7.1 recommends shipping uncompacted for v1, and
`02` §6.2 fixes the revisit trigger at a payload past ~1 MB.

### Scope held

`0051` owns the contract this ticket makes possible: the fault-injection test on the ordering, the
delta GC and `deltasFrom` walking forward, the `Profile.exploredGeneration` mirror and its repair,
and the manifest's field list as a contract. This ticket writes the objects and the headers;
`0051` proves the contract.

### One finding, filed not fixed

The worker writes `users/<uid>/…` where `<uid>` is the Cognito `sub` (`02` T1: *"the `<uid>` in
every S3 key"*). `amplify/storage/resource.ts` scopes browser access to `users/{entity_id}/*`,
where `entity_id` is the **identity-pool id** — a different string. So the client cannot yet read
what this writes. That belongs to `0054`, the loader, and is noted here so it is not discovered
there as a surprise.

## Operator validation

**Nothing here needs the operator.** Everything was reachable with `AWS_PROFILE=devault` and was
run (D-181). What is left for a real run is listed at the end and is genuinely about a human eye.

### Automated

- **1,438 tests, 74 files.** New: `explored-blob.test.ts` (41), `explored-agg.test.ts` (10),
  `explored-generation.test.ts` (16), `explored-blob-store.test.ts` (26),
  `explored-rebuild.test.ts` (8), plus 7 in `process-activity.test.ts`, 8 in
  `explored-cells.test.ts` and 5 in `explored-cells-table.test.ts`.
- `npm run typecheck`, `npm run lint` clean. All seven gate scripts pass, including the new
  `check-fog-hot-path.mjs` (7/7 self-test) and `--self-test` on the other five that carry one.

### Live smoke test — 12/12, real DynamoDB and real S3

A throwaway table (`LostSolesExploredCell-smoke-0049`) and a throwaway bucket, driving the
**shipped** code, both deleted afterwards. Deliberately not the real fog table, which has no delete
path (I-7); `LostSolesExploredCell` was confirmed still at **0 items** after the run.

| # | What it proved |
|---|---|
| 1 | `ADD generation :one` returns `UPDATED_NEW`; a user's first call is 1 with no bootstrap write |
| 2 | **20 concurrent bumps returned 20 distinct numbers**, 1-20, no collision |
| 3 | `raiseGenerationTo` sets a floor, then refuses 411 and refuses 412 again; the next bump is 413 |
| 4 | AGG items land; the conditional `max` refuses a 2024 backfill (`advanced: 0`) |
| 5 | `rebuildFromTable` pages a real `Query` past one response, 278 cells, strictly ascending |
| 6 | Real S3 returns `Cache-Control: public, max-age=31536000, immutable` and `Content-Encoding: gzip` on the blob, `no-cache` and no encoding on the manifest |
| 7 | The second publish merges generation 1 and reports the right `cellCount` |
| 8 | **A real 412**: a stale `IfMatch` is refused by S3 itself, and the writer recovers |
| 9 | `IfNoneMatch: "*"` refuses a second bootstrap for a fresh user |
| 10 | The sidecar stayed parallel across three real generations, with the right generation stamped |
| 11 | **AP-17's rebuild is byte-identical to the blob S3 serves** for a three-run history ingested and published in lockstep — cells, days and encoded bytes all equal |

### Carried to the first real import

1. Sync a run; `users/<uid>/explored/` gains `explored-r10.<gen>.bin` at one higher `<gen>` and the
   old file is still there. *(Mechanically proven above; what a real run adds is that the ingest
   worker's own role can do it, which only the deployed IAM can show.)*
2. Open `manifest.json` in a browser tab — `generation`, `cellCount` and `updatedAt` reflect the
   run just imported. It is written pretty-printed and uncompressed for exactly this.
3. After a run over entirely known ground, the new blob is within a few bytes of its predecessor.
