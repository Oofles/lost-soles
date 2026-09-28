---
id: 210
slug: make-the-frontier-rim-visible
title: Make the frontier rim visible — it cannot read at any rimAmt in range
type: feature
priority: low
status: open
size: m
capability: 15-two-map-modes-and-cold-territory
depends_on: [119]
blocked_by: []
source: agent
created: 2026-09-28T12:27:56Z
---

## Description

Filed from `0119`. §4.3 calls the warm rim *"the single detail that sells the effect"* and §5.2
gives it `u_rimAmt` 0.08 (atlas) to 0.30 (adventure). **At no value in that range can it be seen.**
`0119` rendered it over the real basemap at z16 (`tools/fog-harness/tune.mjs`): 0.08 adds
~+10/255 (as `0056` measured) and 0.30 only ~+30/255. The operator approved shipping 0.30 as the
most the range allows.

The cause is structural, not a tuning miss. The shader adds `u_rimGlow * rim * u_rimAmt` to the fog
colour and *then* premultiplies by alpha, so the rim is scaled by the boundary's own alpha, about
`0.5 * u_maxOpacity` ≈ 0.45 at the rim's peak. Its only escape into cleared ground is
`alpha = max(alpha, rim * 0.10)`, which is tiny. At `u_rimAmt = 0.60` (outside the range, rendered
for comparison) a hairline appears, but on the stock grey/blue basemap it reads as a **grey outline,
not lantern light**. The parchment hue `u_rimGlow` was chosen to pick up (§5.1) does not exist until
this capability's parchment fork.

This is a design question first: what should the rim be (additive glow independent of alpha, a
wider band, a different colour), and does it wait for the parchment basemap?

## Acceptance criteria

- [ ] A rim design is chosen and recorded as a `D-xxx`: how its contribution relates to fog alpha, and
      its band width and colour.
- [ ] §4.3 and §5.2 of `05-fog-of-war.md` are amended to match, including the `u_rimAmt` range if it
      changes.
- [ ] Rendered over the parchment basemap (or the stock one, if the decision is not to wait) with
      `tools/fog-harness/tune.mjs`, and the rim reads as warm light at the frontier at z16.
- [ ] Labels inside revealed ground at the frontier are no less readable than with the fog off (D-051).
      A rim that bleeds light into cleared ground is exactly where this can break.

## Notes

- `0119`'s screenshots: `docs/capabilities/assets/0119/`. The comparison sheet showing 0.08, 0.30
  and 0.60 at 2x was not committed; regenerate it with `tune.mjs` plus a variants file.
- Probably depends on the parchment fork landing first; if so, add that dependency when the fork has
  a ticket.

## Operator validation

Desktop browser (D-240). Look at the frontier at z16 over the parchment basemap: does the rim
read as warm lantern light at a glance, without zooming the screenshot, and are the street names
at the edge as readable as with `?fog=off`? A perceptual call (D-229).
