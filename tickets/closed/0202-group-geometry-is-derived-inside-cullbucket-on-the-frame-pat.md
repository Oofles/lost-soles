---
id: 202
slug: group-geometry-is-derived-inside-cullbucket-on-the-frame-pat
title: Group geometry is derived inside cullBucket, on the frame path — up to 20 ms in a single pan
type: bug
priority: high
status: closed
size: m
capability: 08-map-and-fog-renderer
depends_on: []
blocked_by: []
source: agent
created: 2026-09-11T14:02:46Z
started: 2026-09-11T17:15:35Z
closed: 2026-09-11T18:38:55Z
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

- [x] Group geometry is not materialised synchronously inside a `move`/`zoom` handler.
- [x] A pan into unmaterialised ground costs no single main-thread block over ~5 ms (§6.3's own
      figure for the padded-region-exit row). *Measured: `pan-across` gross max fell from 21.1 ms to
      **0.20 ms**.*
- [x] Whatever the fog draws while a group is still being derived is defined and not a hole — a
      group that has not materialised must not read as unexplored, because ground that flickers back
      to fog is indistinguishable from a D-020 violation to anyone looking at it. *Unreachable by
      construction: the cull is untouched. See `## Resolution`.*
- [x] `tools/fog-harness/run-perf.mjs`'s `derive inside` column is ~0 ms for the pan phases.
      *Exactly 0.00 ms in `pan-across`, `pan-z17` and `zoom-in`.*
- [x] (operator) Panning into territory not yet drawn this session shows no visible hitch on the
      desktop browser.
      — verified 2026-09-11: operator confirmed on the desktop browser.

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

## Resolution

**The cull is untouched. The derivation is done BEFORE it is needed instead.**

That choice is the whole design and the Notes pointed the other way, so it is worth stating why. The
obvious fix — materialise at most N groups per cull and finish the rest later — puts a **hole** in the
fog: a group with no geometry contributes no discs, so explored ground draws as unexplored until the
next slice lands. On a map whose entire premise is that it never re-fogs (D-020), territory that blinks
out is the worst-looking bug available and is indistinguishable by eye from data loss. Bounding the
cull trades a frame drop for a correctness-shaped symptom.

So `lib/fog/prefetch.ts` walks the groups intersecting a region **wider** than the padded viewport
(`PREFETCH_PAD = 0.5` against §6.2's 0.2) and materialises them in **time-sliced** idle callbacks.
`discsFor` is idempotent and returns the cached array for a warm group, which is what makes it safe to
re-walk the whole region on every rebuild rather than tracking what has been done.

Two schedule points, because there are two different expensive cases:

- **After every rebuild** — warms the ground around what was just drawn, so the next pan into it is a
  cache read.
- **During the bucket-switch debounce** — the case the first one cannot reach, because the incoming
  bucket did not exist when the last rebuild ran. §6.1 already makes the camera wait ~250 ms before
  switching and that window is otherwise spent doing nothing.

**The second one needed a correction that the tests caught.** `#camera` deliberately ignores camera
events while a switch is pending, so a pinch crossing several bands aimed the prefetch at the *first*
band crossed while `#rebuild` resolves the resolution at *fire* time — warming a bucket the rebuild
would not use, which is worse than not prefetching at all: the work is spent and the derivation still
lands on the frame path. `#scheduleSwitch` now re-aims when the band changes, at one index derivation
per band actually crossed.

`PREFETCH_SLICE_MS = 4`, and the budget is checked **after** the work rather than before: a group costs
10-90 ms, so a check-first loop would do nothing on every slice and never finish. Overrunning by one
group is the correct trade and is the only reason it makes progress.

### Measured, 150k cells, `run-perf.mjs`

```
                     before                      after
  pan-across   derive inside 39.70 ms      derive inside  0.00 ms
               gross max     21.10 ms      gross max      0.20 ms
  zoom-in      derive inside 83.20 ms      derive inside  0.00 ms
  pan-z17      (no culls at all)           derive inside  0.00 ms
```

**`zoom-out` still shows ~700 ms and that is a harness artefact, not a remaining bug.** The headless
harness runs with `debounceMs: 0`, so there is no debounce window for the band-crossing prefetch to
use. The harness now prints that caveat in its own header rather than leaving the number to be
misread; the behaviour is covered by `viewport-controller.test.ts`, which can drive a clock.

**Files:** `lib/fog/prefetch.ts` (new), `lib/fog/viewport-controller.ts` (`requestIdle` on
`ControllerHost`, the two schedule points, cancellation on stop/hide), `tools/fog-harness/perf-harness.js`.

**Tests.** Eight in `prefetch.test.ts` — which groups are walked, that a warm group costs nothing, the
slice budget, resuming across slices without deriving anything twice, and that it always derives at
least one group even when the budget is already blown. Nine in `viewport-controller.test.ts` covering
both schedule points, the re-aim, no idle work while hidden, no spinning once the region is warm, and
cancellation on stop. The fake host's idle queue drains only when a test asks, so the existing
frame-path assertions stay provable.

## Operator validation

Smoke test, run by the agent: `node tools/fog-harness/run-perf.mjs 150k` — `derive inside` is 0.00 ms
in every pan phase and the worst single pan cull is 0.20 ms gross, against 21.10 ms before.

**The perceptual check has been done. 2026-09-11, operator, desktop browser: no visible hitch.**

This is the check the ticket was filed from, and it closes the loop the numbers could only half close.
`0059` measured a 21.1 ms block inside a single pan cull — a dropped frame by arithmetic — but a
dropped frame is not automatically a *felt* one, and the whole reason D-181 reserves this class of
question for a human is that nothing in the table can answer it. The block is gone from the
measurement and gone from the experience.

Worth noting what this does NOT cover: the band-crossing path. The harness runs with `debounceMs: 0`
and cannot exercise the debounce-window prefetch, so that half rests on
`viewport-controller.test.ts` rather than on either a harness number or an eye. A pinch that stutters
in future use is the thing to look at first.
