---
id: 202
slug: group-geometry-is-derived-inside-cullbucket-on-the-frame-pat
title: Group geometry is derived inside cullBucket, on the frame path — up to 20 ms in a single pan
type: bug
priority: high
status: open
size: m
capability: 08-map-and-fog-renderer
depends_on: []
blocked_by: []
source: agent
created: 2026-09-11T14:02:46Z
---

## Description

`05-fog-of-war.md` §6.3's table budgets two separate things:

| | work | budget |
|---|---|---|
| CPU on padded-region exit | two-level cull + VBO upload | **1-5 ms, off the frame path** |
| Bucket derivation, cold | `cellToParent` pass + dedupe + bbox precompute | **30-80 ms, debounced, once per bucket** |

**The code runs the second inside the first, on the frame path.** `cullBucket` calls
`bucket.discsFor(group)`, which materialises that group's ids, fractions, projection and bridges the
first time it is asked — and the cull runs inside `FogViewportController`'s `move`/`zoom` handler,
which MapLibre dispatches inside its own frame.

`0059`'s instrumentation separates the two clocks and the split is stark (150k cells, 400x800,
headless Chromium on this development machine):

```
                culls      net max    net mean   gross max   derive inside
  load              1      1.60 ms     1.60 ms    141.80 ms      140.20 ms
  pan-across        9      0.20 ms     0.11 ms     19.60 ms       37.40 ms
  zoom-out         17      0.40 ms     0.10 ms    253.20 ms      633.00 ms
  zoom-in           8      0.20 ms     0.06 ms     83.20 ms       83.20 ms
```

**The cull is not the problem — it is 0.1 to 0.4 ms, well inside §6.4 item 4's 2 ms.** §6.2's
two-level design works. What costs is the derivation it performs on the way, and a **single pan cull
reached 19.6 ms** of synchronous main-thread work. At 60 fps a frame is 16.7 ms, so one pan into
ground the bucket has not seen yet drops a frame by itself — which is precisely what §6.4 item 6's
*"zero long tasks attributable to the fog layer during pan"* is meant to catch, and what the phone
will feel as a hitch when the operator pans into new territory.

Numbers at 500k are worse in the same shape: 39.1 ms of derivation inside pan culls, 396 ms inside
the zoom sweep.

## Acceptance criteria

- [ ] Group geometry is not materialised synchronously inside a `move`/`zoom` handler.
- [ ] A pan into unmaterialised ground costs no single main-thread block over ~5 ms (§6.3's own
      figure for the padded-region-exit row).
- [ ] Whatever the fog draws while a group is still being derived is defined and not a hole — a
      group that has not materialised must not read as unexplored, because ground that flickers back
      to fog is indistinguishable from a D-020 violation to anyone looking at it.
- [ ] `tools/fog-harness/run-perf.mjs`'s `derive inside` column is ~0 ms for the pan phases.
- [ ] (operator) Panning into territory not yet drawn this session shows no visible hitch on the
      desktop browser.

## Steps to reproduce

1. `node tools/fog-harness/run-perf.mjs 150k`
2. Read the `culls, per phase` block: `gross max` against `net max`.

## Expected vs actual

**Expected:** §6.3 — the cull costs 1-5 ms on the frame path; derivation costs 30-80 ms off it.

**Actual:** the cull costs 0.1-0.4 ms and performs up to 19.6 ms of derivation on the frame path in
one go.

## Notes

**Do not reach for a worker first.** `ZoomBucket` holds an `ExploredSet` and h3 state that would have
to cross a structured clone, and §6.1's whole design is that derivation is lazy and cheap per group.
The cheaper shapes to consider first are: materialising a bucket's groups ahead of the camera (the
padded region already tells you which are coming), or bounding how many groups may be materialised in
one cull and finishing the rest in an idle callback — `02` §6.5 already requires
`persistToIndexedDB` to run that way and says why.

This was invisible before `0059` because `CullResult.ms` measures both halves and nothing separated
them. `cull.test.ts` already declined to assert a wall-clock number for a related reason.

## Operator validation

TODO — written when the ticket is worked.
