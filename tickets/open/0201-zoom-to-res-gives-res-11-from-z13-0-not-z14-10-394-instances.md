---
id: 201
slug: zoom-to-res-gives-res-11-from-z13-0-not-z14-10-394-instances
title: ZOOM_TO_RES gives res 11 from z13.0, not z14 — 10,394 instances at z13.5 against §6.4's 6,000
type: bug
priority: high
status: open
size: s
capability: 08-map-and-fog-renderer
depends_on: []
blocked_by: []
source: agent
created: 2026-09-11T14:02:46Z
started: 2026-09-11T17:15:35Z
---

## Description

`0059`'s scripted camera path samples fractional zooms, which no previous measurement did, and the
instance count peaks at **z13.5** rather than at an integer zoom. On a 400x800 CSS px viewport over
solid ground it draws **10,394 instances** — 1.73x §6.4's ceiling of 6,000, and **identical at
50k, 150k and 500k stored cells**, so it is a property of the zoom table rather than of the data.

`lib/fog/zoom-buckets.ts`:

```ts
{ maxZoom: 13, res: 10 },
{ maxZoom: Infinity, res: RES },   // RES = 11
```

`resForZoom` returns the first band whose `maxZoom >= zoom`, so **res 11 owns every zoom above 13.0**,
not from z14 as that file's own header states twice:

> *"Res 11 therefore owns **z14 and up**, which is the whole of the ticket's "typical running zooms
> (z14–17)". z13 is res 10 and blobbier on purpose: a fully-revealed 400x800 viewport at z13 holds
> ~2,100 res-10 cells and would hold ~14,700 res-11 ones, so the finer bucket is not available there
> at any price."*

The half-open band `(13, 14)` is exactly the interval that argument excludes, and it is a zoom a
pinch passes through and a user can rest at. The measured 10,394 is the post-D-238 number; the
header's ~14,700 is the pre-elision one, so the two agree.

**This is a design question, not only an arithmetic one**, which is why `0059` filed it rather than
changing the table: the fix trades fog detail at z13-14 for the instance ceiling, and the header
already argues that trade one way. `{ maxZoom: 14, res: 10 }` would satisfy the ceiling but also make
**z14 itself** res 10, which contradicts *"res 11 owns z14 and up"* and makes a prime running zoom
blobbier. The band model's `maxZoom <= ` comparison cannot express "res 10 below z14, res 11 from
z14" without either a `minZoom` table or a strict comparison on that one band.

Note the same band-bottom effect appears one level down and is nearly harmless: **z12.5 draws 6,007
at res 10**, 0.1% over. The pattern is general — each band's worst case is its bottom — and a fix
should be checked against every band rather than only this one.

## Acceptance criteria

- [x] `visibleInstanceCount` is at or under §6.4's 6,000 at **every** zoom including fractional ones,
      on a 400x800 CSS px viewport over solid ground, at 50k / 150k / 500k cells.
- [x] The zoom table expresses the intent `zoom-buckets.ts`'s header already states, and the header
      and the table say the same thing.
- [x] `node tools/fog-harness/run-perf.mjs` exits 0 on item 1 at all three dataset sizes.
- [x] A `D-xxx` records the resolution/ceiling trade if the answer is anything other than "the table
      was simply wrong". *No new `D-xxx`: the table WAS simply wrong — it contradicted its own
      header — so `05` §6.1 is amended in place with the reasoning and the measured band bottoms.*
- [x] (operator) At z13.5 on the desktop browser the fog is still legible territory rather than a
      visibly coarser blob appearing mid-pinch. D-051.
      — verified 2026-09-11: operator confirmed on the desktop browser.

## Steps to reproduce

1. `node tools/fog-harness/run-perf.mjs 150k`
2. Read the item 1 row and the per-zoom histogram.

## Expected vs actual

**Expected:** `visibleInstanceCount` <= 6,000 at every zoom on a 400x800 viewport (§6.4 item 1).

**Actual:** 10,394 at z13.5, res 11. The peak sits at the bottom of res 11's band, where the finest
bucket is drawn over the largest viewport that band allows.

## Notes

Found by the instrument §6.4 asked for, on its first run. The previous measurement recorded in §6.4
(*"the peak is 5,271 at z14"*) is correct and reproduces exactly — it only ever sampled integer
zooms. That is the argument for a scripted path over a spot check, and it is worth keeping in §6.4
when this is resolved.

## Operator validation

TODO — written when the ticket is worked.

## Resolution

**The bounds are now inclusive LOWER bounds.** `ZoomBand.maxZoom` became `ZoomBand.minZoom`, the table
is ordered finest-first, and `resForZoom` returns the first band with `zoom >= minZoom`.

The old form made every band lower-exclusive, so res 11 owned `(13, ∞)` while this file's own header
said twice that it owns *"z14 and up"*. **A band's worst case is its bottom** — the finest resolution
over the largest viewport it allows — and lower-exclusive bands put that bottom just above an integer,
where nothing had ever been measured: every figure in §6 was taken AT an integer zoom, which under the
old form was each band's *best* case. Lower-inclusive bounds move the bottom onto the integer, so the
recorded numbers become the ones that have to hold.

Measured band bottoms, solid ground at 30°N, 400x800 padded, worst of 50k / 150k / 500k:

```
  z6 → 28   z7 → 101   z8 → 390   z10 → 1,935   z12 → 1,861   z13 → 3,062   z14 → 5,271
```

The worst case in the whole table is now **5,271 at z14** — which is exactly the figure §6.4 already
recorded, no longer a best case. `run-perf.mjs` reports `5,273 peak, at z14.0  PASS`.

**Res 9 starts at z12 rather than the derived 11.30, and finding that out is the part worth keeping.**
The first attempt rounded every solved figure and landed res 9's bottom on z11 — which passed the
design's own "8-30 CSS px per cell" rule at 12.2 px and **failed the ceiling at 6,650 instances on
500k cells**. The two disagree because at z11 a 500k disc does not fill the viewport: the count there
is bounded by how many res-9 cells exist rather than by the screen, and a px-per-cell proxy cannot see
that. The px rule is a good derivation and a bad assertion. z12 is also where the old table effectively
put z11 anyway, so nothing regressed visually.

What changed at integer zooms is only **z8, res 6 → res 7** (finer, 390 instances, 10.6 px). Every
other integer zoom resolves exactly as before. All the fractional zooms shift one band coarser, which
is the fix.

**Files:** `lib/fog/zoom-buckets.ts` (the table, `ZoomBand`, `resForZoom`), `docs/05-fog-of-war.md`
§6.1 (the table, the reasoning, the measured bottoms), `lib/fog/zoom-buckets.test.ts`.

**Tests.** The table test now asserts the fractional zooms — `[13.5, 10]` is the bug itself — and a
new test walks **every band bottom** and checks the 8 px floor there. Its absence is why this shipped:
the existing sweep checked integer zooms, which the old table made each band's best case, so the rule
could hold at every one of them while being broken a hair above. A second new test pins `NaN` falling
through to the **coarsest** bucket rather than the finest, which the old fallthrough got backwards —
a map mid-teardown returned `RES`, the most expensive bucket, at the moment it could least afford it.

## Operator validation

The mechanical half is `node tools/fog-harness/run-perf.mjs`, which now passes item 1 at all three
dataset sizes, plus the `cull.test.ts` canary which sweeps every zoom at every dataset size.

**The perceptual check has been done. 2026-09-11, operator, desktop browser: good.**

The question was genuinely open and no number could have answered it (D-181, D-227). Fog between z13
and z14 is now res 10 rather than res 11 — one step blobbier through that band. The arithmetic said it
had to be (a res-11 bucket there is 10,394 discs against a 6,000 ceiling) and §6.1 already argued z13
should be blobbier on purpose, but whether the band *reads* as territory rather than as a smear was a
matter of taste. It reads.

That is worth recording rather than just ticking, because it is the second time the bucket ladder has
been judged by eye and passed — `0194` rejected a res-10 brush at the running zooms, and this confirms
the ladder is acceptable one step coarser in the band **below** them. A future ticket tempted to widen
a band has that evidence and does not have to re-open the question from scratch.
