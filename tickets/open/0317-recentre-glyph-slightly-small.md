---
id: 317
slug: recentre-glyph-slightly-small
title: The ⌖ recentre glyph is slightly small inside its button
type: chore
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: operator
created: 2026-10-26T13:41:13Z
started: 2026-10-26T20:52:53Z
---

## Description

The operator's perceptual check for `0112` (2026-10-26, desktop browser, deployed app): the `⌖`
recentre control renders as a crosshair, correctly, but the glyph sits small inside its 40×40 button
and should be slightly larger. `.map-control` sets `font-size: 18px` for every map control
(`components/map/map-controls.tsx`, `MAP_CONTROLS_CSS`); `⌖` reads smaller at that size than
fit-to-territory's `⤢` does.

## Acceptance criteria

- [ ] The `⌖` glyph is enlarged inside its button. The button stays 40×40 (D-313), and the other
      map controls' glyphs are unchanged.
- [ ] (operator) In the desktop browser, `⌖` reads at a comparable visual weight to `⤢` beside it.

## Notes

Cosmetic. Scope it to the `⌖` span (e.g. a class on that span), not `.map-control`, so the other
glyphs don't move. Touches the same `MAP_CONTROLS_CSS` as `0314`, so it may land in a later wave.

2026-10-26, from `0314`'s agent: the zoom harness renders `⌖` as a missing-glyph box, because the
self-hosted fonts in `app/fonts` lack the character (see
`docs/capabilities/assets/0112/home-1280x800-200pct.png`, second control in the top row). In a real
browser a system fallback font draws it, possibly at a different size, which may be the cause of
"slightly small". Check the font coverage before resizing the span.

## Operator validation

The (operator) criterion above, on the desktop browser.
