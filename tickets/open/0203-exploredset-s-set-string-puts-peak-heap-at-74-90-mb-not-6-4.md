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

- [ ] Peak JS heap over baseline is in the low tens of MB at 500,617 cells.
- [ ] `has()` is a binary search over `#cells`, or the memory is reduced another way and §6.4 is
      amended to say what the real figure is and why.
- [ ] `fromBlob` does not hold a boxed `bigint[]` of every cell at its peak.
- [ ] `explored-set.test.ts` still proves membership, ordering and `applyDelta` unchanged.
- [ ] `node tools/fog-harness/run-perf.mjs 500k` exits 0 on item 7.

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

## Operator validation

TODO — written when the ticket is worked.
