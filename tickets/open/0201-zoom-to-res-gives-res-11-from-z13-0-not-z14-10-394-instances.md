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

- [ ] `visibleInstanceCount` is at or under §6.4's 6,000 at **every** zoom including fractional ones,
      on a 400x800 CSS px viewport over solid ground, at 50k / 150k / 500k cells.
- [ ] The zoom table expresses the intent `zoom-buckets.ts`'s header already states, and the header
      and the table say the same thing.
- [ ] `node tools/fog-harness/run-perf.mjs` exits 0 on item 1 at all three dataset sizes.
- [ ] A `D-xxx` records the resolution/ceiling trade if the answer is anything other than "the table
      was simply wrong".
- [ ] (operator) At z13.5 on the desktop browser the fog is still legible territory rather than a
      visibly coarser blob appearing mid-pinch. D-051.

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
