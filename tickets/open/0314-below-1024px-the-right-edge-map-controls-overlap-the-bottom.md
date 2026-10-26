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
started: 2026-10-26T13:42:13Z
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

- [x] `node tools/a11y/run-zoom.mjs` passes, with no overlap on any screen at any of its window sizes.
- [x] The ≥1024px rail layout is unchanged; the harness's screenshots at 100% are identical in layout.
  *(Amended: the harness has no 100% shots. Its rail case is 2560×1440 at 200%, a 1280×720 viewport, measured but not pictured. It was pictured temporarily before and after the change, and all eight screens' PNGs are byte-identical.)*
- [x] (operator) At 200% zoom in the desktop browser, `/` and `/chronicle` look right with the controls clear of the card and panel. — verified 2026-10-26: operator reports the checks are good.

## Notes

`0112` reports that the fix spans `PLINTH_CSS`, `MAP_CONTROLS_CSS`, `REGION_JUMP_CSS` and
`CHRONICLE_CSS` together. Where the controls go below 1024px is a layout choice D-313 does not settle.
Propose the options before building (D-152). `0112` stays open until this closes.

## Operator validation

The (operator) criterion above, on the desktop browser.

**Result, 2026-10-26:** the operator checked `/` and `/chronicle` at 200% zoom in the desktop browser and
reported them good. Smoke tests after Amplify build 430 (commit `6930ac7`): `node tools/a11y/run-zoom.mjs`
prints `ZOOM HARNESS PASS` on merged main, and the deployed client chunks carry the new
`top: 16px; right: 64px` jump-to rule.

## Resolution

**Layout chosen by the operator (option A, relayed by the orchestrator, D-152).** Below 1024px the
four right-edge map controls are now one row along the top-right: fit, `⌖`, jump-to, `⚙`. They are
40px tall at `top: 16px`, 8px apart, and `⚙` keeps the corner. The Chronicle starts 16px below the mode
toggle (`top: 98px`) at full width. Nothing at ≥1024px changed: the media queries restore exactly the
old values.

Why the old layout failed: the column ran from 16px to 200px down the right edge, and the bottom
card (55vh cap, 36px off the bottom) starts at about 144px in a 400px-tall viewport. The Chronicle's
`top: 72px` was set when only `⚙` shared the top edge. It never got the revisit for the mode
toggle (66px tall, so its bottom is at 82px) that §2.5 promised, and it predates jump-to and the
below-1024 column.

Files:
- `components/map/map-controls.tsx`: `.map-controls` below 1024px is a row at `top: 16px;
  right: 112px`. The `min-width: 1024px` block restores `right: 16px; flex-direction: column` with
  `bottom: 36px`, as before.
- `components/map/region-jump-control.tsx`: `.region-jump` below 1024px is at `top: 16px; right: 64px`.
  A new `min-width: 1024px` block restores `top: 64px; right: 16px`.
- `components/chronicle/chronicle-panel.tsx`: the below-1024px `top` goes from 72px to 98px
  (16 + the mode toggle's 66px + 16), with a comment giving the arithmetic.
- `components/map/region-jump-control.test.tsx`: the position assertion is split into the ≥1024px
  rule (unchanged values) and the new below-1024px rule.
- `docs/06-ui-ux.md`: §2.2's "Below 1024px" paragraph (the row), §2.5's Chronicle bullet
  (`top: 98px`, which closes "the 72px is revisited when the mode toggle lands"), and §9.2's
  below-1024 bullet. All of them cite `0314` and **D-448**. The orchestrator replaces that
  placeholder with the allocated id.
- `docs/capabilities/assets/0112/{home,chronicle}-{1280x800,1920x1080}-200pct.png`: regenerated
  with `run-zoom.mjs --commit`. The other committed shots came out byte-identical.

Decisions: D-448 (proposed). Below 1024px the map controls are one top-right row and the
Chronicle's top is 16px below the mode toggle. It amends 06 §2.2 and §2.5. D-313 and D-251 are
unchanged in substance.

Costs accepted: below 1024px the row's visual order (fit, `⌖`, jump-to, `⚙`) is the reverse of the
DOM and tab order (`⚙`, jump-to, fit, `⌖`). The row needs 16 + 112 + 184 + 16 = 328px of width,
inside §9.2's ~360px floor. Under that, the toggle and the row would meet.

Out of scope: in the harness the `⌖` glyph renders as a missing-glyph box, because the self-hosted
fonts lack U+2316. This is reported for the orchestrator, not fixed here (see `0317`).
