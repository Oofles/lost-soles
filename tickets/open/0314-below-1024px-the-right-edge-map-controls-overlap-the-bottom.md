---
id: 314
slug: below-1024px-the-right-edge-map-controls-overlap-the-bottom
title: Below 1024px the right-edge map controls overlap the bottom card and the Chronicle
type: bug
priority: high
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-26T12:32:10Z
---

## Description

Found by `0112` (capability 18 wave 1, 2026-10-26) grading `06` §9.6's *200% browser zoom* row,
which is an MVP-gate row (`09` §9.5 row 4). Below 1024px, D-313's layout is an opaque bottom card
capped at 55% of the height. The right-edge map control column (gear, jump-to, fit, `⌖`, about 184px
tall) does not fit beside that card. At 200% of a 1280×800 window (about 640×400 CSS px), the controls
sit on top of the card. The Chronicle panel (`top: 72px`, `right: 16px`) runs under the controls and
the mode toggle at any width under 1024px.

Nothing scrolls horizontally and no text clips, so this is the only failing part of the row.
`tools/a11y/run-zoom.mjs` measures it, and `docs/capabilities/assets/0112/` holds the screenshots.

## Steps to reproduce

1. `node tools/a11y/run-zoom.mjs`
2. Or, in the desktop browser, open `/` at 200% zoom in a 1280×800 window, then open `/chronicle`.

## Expected vs actual

**Expected:** below 1024px, nothing overlaps; every control and panel is fully visible and clickable
(D-313: "below 1024px it only must not break").

**Actual:** `ZOOM HARNESS FAIL (3)`: home at 1280×800, and chronicle at 1280×800 and 1920×1080, at 200%.

## Acceptance criteria

- [ ] `node tools/a11y/run-zoom.mjs` passes, with no overlap on any screen at any of its window sizes.
- [ ] The ≥1024px rail layout is unchanged; the harness's screenshots at 100% are identical in layout.
- [ ] (operator) At 200% zoom in the desktop browser, `/` and `/chronicle` look right with the controls clear of the card and panel.

## Notes

`0112` reports that the fix spans `PLINTH_CSS`, `MAP_CONTROLS_CSS`, `REGION_JUMP_CSS` and
`CHRONICLE_CSS` together. Where the controls go below 1024px is a layout choice D-313 does not settle.
Propose the options before building (D-152). `0112` stays open until this closes.

## Operator validation

The (operator) criterion above, on the desktop browser.
