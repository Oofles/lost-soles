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

- [ ] `traceToCells` reports per-reason drop counts alongside its cell set — at minimum
      `accuracy` (the `MAX_ACC_M` gate), `duplicate` (consecutive identical coordinates) and
      `nonFinite`, plus `speedGate` if the teleport split can be attributed per sample.
      The `Set` return must stay the primary, ergonomic result; existing callers should not
      have to destructure to get it.
- [ ] `0045` and `0046`'s tests still pass unchanged in substance — this widens the contract,
      it does not alter a single classification.
- [ ] The counts reach T3's `traceRejectCounts` through `activityItem`, written even when all
      zero, so the row shape does not vary (the same rule `cellCount: 0` follows).
- [ ] A fixture whose every sample fails the accuracy gate produces `cellCount: 0` **and**
      `traceRejectCounts.accuracy` equal to its point count.
- [ ] The ingest logs one warning — not one per sample — when a trace had points and yielded
      zero cells, naming the counts. A traceless activity logs nothing: it is not a fault.
- [ ] `05-fog-of-war.md` §3.6's last bullet cites the field, so the doc and the column agree.

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

## Operator validation

Nothing operator-visible. This is a column and a log line; a smoke test on a synthetic
all-bad-accuracy fixture is the whole verification, plus reading the emitted log once.
