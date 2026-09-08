---
id: 180
slug: trace-reject-counts-reach-t3-make-a-silently-garbage-gps-rec
title: Trace reject counts reach T3 — make a silently-garbage GPS record visible
type: feature
priority: med
status: open
size: s
capability: 07-fog-projection-and-cells
depends_on: [48]
blocked_by: []
source: agent
created: 2026-09-08T05:20:45Z
started: 2026-09-08T15:06:32Z
---

## Description

`05-fog-of-war.md` §3.6, last bullet: *"A trace with points but **all** of them filtered out by
§2.2 is treated as no-GPS, and the ingest logs a warning with the reject counts so it is visible
rather than silently scoring nothing."* `02-data-model.md` T3 has the column for it —
`traceRejectCounts: M` — *"`{speedGate, accuracy, duplicate}` — makes a silently-garbage GPS
record visible"* — and `amplify/data/resource.ts` declares the type.

**Half of that shipped in `0048` and half did not.** The *treated as no-GPS* half falls out for
free: `cells.size === 0` takes the same path as a treadmill run and writes `NO_CELLS`. The
*visible* half did not, and the column is written by nobody.

The reason it was left is a real one rather than an oversight. `traceToCells` returns a
`Set<H3Index>` and nothing else. Making it report why it dropped samples means widening the
return type of a function two closed tickets (`0045`, `0046`) specify precisely, and `0048` had
no criterion asking for it — so it was filed rather than smuggled in.

Without this, a watch that emits 2,000 fixes with 60 m accuracy produces an activity that looks
exactly like a treadmill run: zero cells, zero credit, no error, nothing in the log to say the
GPS was the problem. That is the failure §3.6 names, and it is the kind that gets diagnosed a
month later.

## Acceptance criteria

- [x] `traceToCells` reports per-reason drop counts alongside its cell set — at minimum
      `accuracy` (the `MAX_ACC_M` gate), `duplicate` (consecutive identical coordinates) and
      `nonFinite`, ~~plus `speedGate` if the teleport split can be attributed per sample~~
      **plus `segments`**.
      The `Set` return must stay the primary, ergonomic result; existing callers should not
      have to destructure to get it.
      **The conditional resolved to NO** — the teleport split cannot be attributed per sample,
      because it splits rather than drops (D-212), so there is no count to report. `segments`
      is what that gate actually produces and is reported instead. D-222.
      *The `Set` clause is met literally: `traceToCells` returns `Set<H3Index> & { rejects }` —
      a plain Set with one extra property, not a subclass and not a tuple.*
- [x] `0045` and `0046`'s tests still pass unchanged in substance — this widens the contract,
      it does not alter a single classification. *Unchanged FULL STOP: not one line of
      `fog.test.ts`'s existing 42 tests was touched, which is the strongest form of the claim.*
- [x] The counts reach T3's `traceRejectCounts` through `activityItem`, written even when all
      zero, so the row shape does not vary (the same rule `cellCount: 0` follows).
- [x] A fixture whose every sample fails the accuracy gate produces `cellCount: 0` **and**
      `traceRejectCounts.accuracy` equal to its point count. *Unit and live: 200 fixes at
      `MAX_ACC_M + 10` gave `{accuracy: 200, duplicate: 0, nonFinite: 0, segments: 0}` off a
      real DynamoDB read.*
- [x] The ingest logs one warning — not one per sample — when a trace had points and yielded
      zero cells, naming the counts. A traceless activity logs nothing: it is not a fault.
      *Three handler tests: fires once, silent for a treadmill run, silent for a clean run. The
      emitted line was read once and is recorded below.*
- [x] `05-fog-of-war.md` §3.6's last bullet cites the field, so the doc and the column agree.
      *And `02` T3's column changed with it — D-222.*

## Notes

Filed by `0048`. The `speedGate` count is the awkward one: the teleport gate does not drop a
sample, it *splits* the trace (`0045`, D-212), so "rejected by the speed gate" is not quite a
count of samples. Either define it as the number of splits, or drop the key and say so in the
doc — `02` T3's `{speedGate, accuracy, duplicate}` was written before that distinction existed.
Decide it in the ticket rather than inheriting the doc's word for it.

Also worth checking whether the sanitizer's own reject counts (`0037`) are the better source:
by the time a `Trace` reaches `traceToCells`, the sanitizer has already dropped fixes and
recorded `gaps` for them. If so, this ticket may be plumbing rather than new counting — which
would be the better outcome and would leave `traceToCells` untouched.

### What the ticket's author asked for (kept as context, answered in `## Operator validation` below)

Nothing operator-visible. This is a column and a log line; a smoke test on a synthetic
all-bad-accuracy fixture is the whole verification, plus reading the emitted log once.

## Resolution

Both design questions this ticket's Notes flagged turned out to have clean answers, and both went
the way the Notes hoped rather than the way `02` T3's word suggested.

### `speedGate` does not exist in this layer, and the count that does is already stored

The Notes: *"the `speedGate` count is the awkward one: the teleport gate does not drop a sample,
it SPLITS the trace (`0045`, D-212), so 'rejected by the speed gate' is not quite a count of
samples. Either define it as the number of splits, or drop the key and say so."*

Dropped, and `segments` put in its place — which is the honest thing the gate produces, and a
diagnostic on its own: a recording that arrives as one trace and leaves as eleven pieces has
something wrong with it even when nothing was rejected.

The second half is what settles it. **The per-sample speed-gate count genuinely exists — it is
the adapter sanitizer's** (`0037`), which drops fixes on `MAX_IMPLIED_SPEED_MS` and returns how
many. And it already reaches T3: `normalize.ts` puts it in `activity.source.meta.rejectedPoints`,
and `persist.ts` writes `source` whole. Copying it into `traceRejectCounts` would be two owners
for one number on a row that already carries it — the duplication D-193 names. **D-222.**

The Notes also asked whether the sanitizer's counts were *"the better source"*, which *"would
leave `traceToCells` untouched"*. Half right: they are the better source for the speed gate and
useless for the rest. Accuracy, duplicates and non-finite coordinates are dropped by
`traceToCells`'s own step 1 and nothing upstream sees them.

### The `Set` stayed a `Set`

Criterion 1 asks that the cell set remain *"the primary, ergonomic result"* and that existing
callers *"should not have to destructure"*. `traceToCells` now returns
`Set<H3Index> & { rejects }` — a plain `Set` with one extra property, via `Object.assign`.

Not a subclass: that works too and drags in `Symbol.species` and a two-argument constructor for
no benefit. Not a `{cells, rejects}` tuple: that would have rewritten every call site in `0045`
and `0046` to widen a contract that does not change a single classification. **Not one line of
`fog.test.ts`'s existing 42 tests was touched**, which is the strongest available form of
criterion 2.

### `nonFinite` was worth adding rather than inheriting

`clean()` already dropped `NaN`/`Infinity` coordinates with a silent `continue`. The count should
always be zero and a non-zero value is an adapter bug — exactly the kind of thing that earns a
column rather than a silent skip.

### One thing found that was `0050`'s, not this ticket's

`amplify/data/resource.ts` did not declare `deferredCellCount`. `0050` added it to `persist.ts`
and stopped there — DynamoDB is schemaless so the attribute landed, but **AppSync does not return
a field it has not been told about**, so the column was unreadable by anything that would ever
want it. Fixed here, in the same file and the same edit as `traceRejectCounts`, and called out
rather than folded in silently. `cellsRef`'s stale path comment (`cells/<uid>/…`, corrected by
`0050`) went with it.

### The warning

One line, on the one ingest outcome that looks completely normal and is not:

```
{"at":"process-activity","messageId":"8f2b...","source":"gpslogger","externalId":"9001",
 "ingestKey":"abc123","coldStart":false,"outcome":"trace-yielded-no-cells","activityId":"a-1",
 "rejects":{"accuracy":2000,"duplicate":0,"nonFinite":0,"segments":0}}
```

`log.warn` rather than a field on the info line, because a watch emitting 2,000 fixes at 60 m
accuracy is not an ordinary import. Gated on `rejects != null` — a projection actually ran — so a
genuinely traceless activity logs nothing.

### Files

**Modified:** `src/domain/fog.ts` (`TraceRejects`, `CellSet`, `NO_REJECTS`, counting in `clean`
and at each segment); `src/pipeline/persist.ts` (the column); `src/pipeline/process-activity.ts`
(carries `rejects` through `projectCells` and onto the result);
`amplify/functions/process-activity/handler.ts` (the warning);
`amplify/data/resource.ts` (the customType, plus `0050`'s missing field);
`docs/02-data-model.md` T3, `docs/05-fog-of-war.md` §3.6, D-222.

## Operator validation

**Nothing here needs the operator** — the ticket's own text said so (*"nothing operator-visible…
a smoke test on a synthetic all-bad-accuracy fixture is the whole verification, plus reading the
emitted log once"*), and both halves were done.

### Automated

- **1,531 tests, 76 files.** New: 10 in `fog.test.ts` (the counts, and that the `Set` is still an
  ordinary `Set`), 5 in `process-activity.test.ts` (the column on T3 in every shape an activity
  can take), 3 in `handler.test.ts` (the warning fires once, and stays silent twice).
- `npm run typecheck`, `npm run lint` clean; all seven gate scripts pass.
- **A stale test stub surfaced a real fragility.** `handler.test.ts`'s `persisted` mock predated
  `award`, so the new guard read a property that was not there. The stub was completed *and* the
  condition loosened to `!= null`, because that block runs after the transaction has committed —
  the same rule `0051` applied to the mirror and the GC: nothing past the commit point may turn
  a finished ingest into a redelivery.

### Live smoke test — 6/6, real DynamoDB

A throwaway T3-shaped table, driving the shipped `activityItem`, deleted afterwards.

| # | What it proved |
|---|---|
| 1 | 200 fixes at `MAX_ACC_M + 10` → `cellCount: 0` and `{accuracy: 200, duplicate: 0, nonFinite: 0, segments: 0}` read back off DynamoDB |
| 2 | **A garbage-GPS row and a treadmill row are identical in `cellCount`, `newCellCount` and `xpAwarded`, and differ only in `traceRejectCounts`** — which is the entire point of the ticket |
| 3 | A clean run stores zeros and `segments: 1`, not a missing map |
| 4 | The map round-trips as numbers, not strings |
| 5 | `0050`'s `deferredCellCount` round-trips too |
| 6 | `cellsRef` names the per-run object when there were cells and is null when there were not |

### The log, read once

The line above, rendered through `lib/log.ts`'s redactor exactly as CloudWatch will receive it.
