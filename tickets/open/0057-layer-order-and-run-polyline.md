---
id: 57
slug: layer-order-and-run-polyline
title: Layer order — fog above labels, run polyline above the fog
type: feature
priority: high
status: open
size: m
capability: 08-map-and-fog-renderer
depends_on: [54, 56]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Layer order here is a design decision, not plumbing (`05-fog-of-war.md` §4.4).

**Fog goes above the basemap *and its labels*.** Unexplored place names stay hidden. That is most of
the "uncovering the world" feeling, and it is the reason label placement differs between the two map
modes later. A fog layer inserted below the symbol layers would leave street names floating over
undiscovered ground, which reads as a rendering bug and destroys the mechanic.

**The route goes above the fog.** Your own trace is always visible, even over ground whose cells
have not been written yet — a run that is still syncing must still draw its line.

Route styling, and the colours are specified because they have to survive both backgrounds:

```js
run-glow: line-color #ffb347, line-width 12, line-blur 10, line-opacity 0.35
run-core: line-color #fff2d0, line-width 2.5
both: line-cap round, line-join round; source has lineMetrics: true
```

Warm cream core with an amber glow reads on parchment *and* against dark fog. Pure white blows out
on parchment; pure red vanishes into it. Do not substitute a "nicer" colour — this pairing is doing
two jobs at once and capability `15` will introduce the parchment background these were chosen for.

**Optimisation worth taking:** draw the just-uploaded run's polyline into the **mask** as a thick
soft line as well, so the corridor clears the instant the run appears, before the server's cell
write round-trips back. This writes to the mask texture only, **never to the explored set**, and is
discarded on the next rebuild. The client never invents cells.

Route geometry comes from the stored polyline object per activity, not from the raw archive and not
from the cell set.

## Acceptance criteria

- [ ] The fog custom layer is inserted above every symbol layer in the Protomaps style; a test
      asserts its index is after the last `symbol` layer.
- [ ] Place names and street labels in unexplored territory are not visible through the fog.
- [ ] `run-glow` and `run-core` layers exist above the fog with exactly the paint values above,
      `lineMetrics: true` on the source.
- [ ] A run whose cells have not yet been written still renders its polyline.
- [ ] The optimistic mask write draws the latest run's polyline as a thick soft line into the mask
      and is cleared on the next bucket rebuild.
- [ ] The optimistic path writes to the mask only; a test asserts the explored `Set` and
      `BigUint64Array` are untouched.
- [ ] Toggling the fog layer off leaves basemap and route rendering correct.
- [ ] Route rendering is correct across a trace with a split (0045) — no chord drawn across the gap.

## Notes

The hex grid is not drawn, at all. If the game-y grid read is ever wanted, it is a *separate* faint
decorative `line` layer of hex boundaries, clipped to revealed ground, at high zoom only — and kept
strictly out of the mask (`05-fog-of-war.md` §4.1). Not at this milestone.

## Operator validation

1. On the 6.8in Android phone at zoom 14, pan to the edge of your territory. Inside revealed ground,
   street names must be readable in sunlight; **immediately outside it, no label may be legible
   through the fog.** If names bleed through, the layer insertion point is wrong.
2. Zoom to 16 over a run you imported today. The route line must be clearly visible over both
   revealed ground and fogged ground, and the cream core must not disappear against either.
3. Import a run and open the map before the cell write completes (or with cells deliberately
   delayed). The route's corridor should already read as clear — the optimistic mask line — and
   should not visibly jump or shift when the real cells arrive a moment later.
4. Look at the route at arm's length in bright sun. The amber glow must make the line findable at a
   glance without hunting for a thin white thread.
