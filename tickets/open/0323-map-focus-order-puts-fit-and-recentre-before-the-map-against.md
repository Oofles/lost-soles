---
id: 323
slug: map-focus-order-puts-fit-and-recentre-before-the-map-against
title: Map focus order puts fit and recentre before the map, against 06 §2.2
type: bug
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-28T02:22:22Z
started: 2026-10-28T15:10:12Z
---

## Description

`06-ui-ux.md` §2.2 (l. 283–285) gives the home focus order as `⚙ → jump-to → the map → fit → ⌖`.
In `components/map/map-shell.tsx:739–745`, `<MapControls>` (fit and `⌖`) renders **before** the map
container `<div data-testid="map-shell">`, so Tab actually goes `⚙ → jump-to → fit → ⌖ → map`. The
comment at `map-shell.tsx:726` claims `⚙ → jump-to → the map (§2.2)`, which is only true of
jump-to.

At ≥1024px fit and `⌖` sit bottom-right of the map pane, so DOM order also disagrees with visual
reading order. Found by the capability 18 drift audit (§2, `06` §2.2), 2026-10-27.

## Acceptance criteria

- [x] `<MapControls>` follows the map container in the DOM, so Tab order is
      `⚙ → jump-to → the map → fit → ⌖`, as §2.2 states. CSS keeps their position unchanged at
      every width, including the D-448 row below 1024px.
- [x] A test asserts the DOM order of jump-to, the map container, fit and `⌖`.
- [x] The comment at `map-shell.tsx:726` states the whole order.

## Steps to reproduce

1. Open `/` signed in on the desktop browser.
2. Press Tab from `⚙` until the map container takes focus.

## Expected vs actual

**Expected:** `⚙`, jump-to, the map, fit, `⌖` (06 §2.2).

**Actual:** `⚙`, jump-to, fit, `⌖`, the map, read from the DOM order in `map-shell.tsx`.

## Notes

The controls are `position: fixed` (`MAP_CONTROLS_CSS`), so moving the JSX should not move them on
screen. `run-zoom.mjs`'s 24 layouts are the regression check for that.

## Operator validation

None owed. DOM order is asserted by the test; no layout changes.

D-123 trigger checked? none.

## Resolution

**Files touched**
- `components/map/map-shell.tsx`: `<MapControls>` (fit, `⌖`) moved from before the map container
  to directly after it. Home's DOM order is now jump-to → `<div data-testid="map-shell">` → fit →
  `⌖`, so Tab goes `⚙ → jump-to → the map → fit → ⌖` (06 §2.2). The comment above the JSX now
  gives the whole order and says why moving the JSX moves nothing on screen.
- `components/map/map-shell-focus-order.test.tsx` (new): renders `MapShell` with
  `renderToStaticMarkup` and asserts map container → fit → `⌖` in the markup. Jump-to cannot be
  rendered that way: `RegionJump` draws nothing until it has a loaded map and two regions, and
  effects do not run in the node vitest environment. Its place before the map container is a
  source assertion on the returned JSX, the same tripwire trade `map-shell-build.test.ts` makes.

**Why position is unchanged at every width.** Every element involved is fixed-positioned at all
widths, so sibling order has no effect on layout. `.map-controls` is fixed in `MAP_CONTROLS_CSS`
in the base rule, and the ≥1024px media query only changes `top`/`bottom`/`right`/`flex-direction`.
`.route-chip`/`.route-card` (the popup `MapControls` also renders) are fixed. `.home-pane` (the map
container) is fixed in `PLINTH_CSS`, and so is `.region-jump`. No sibling selector (`+`, `~`,
`:first-child`, `:nth-child`) targets any of them. Stacking is set by `z-index` (controls 1, popup
2, pane auto, and a fixed pane makes its own stacking context), not by DOM order. So the D-448 row
below 1024px (fit, `⌖`, jump-to, `⚙` at `top: 16px`, 8px apart) keeps its position and order: the
order inside the row comes from each control's own `right` offset and does not depend on the DOM.
D-448's recorded cost, "below 1024px the row's visual order is the reverse of tab order", still
holds. This ticket does not change it.

**A finding on the ticket's Notes.** The Notes name `tools/a11y/run-zoom.mjs` as the regression
check for layout. That harness stubs `@/components/map/map-shell` (its `STUBBED` list), so it never
renders `MapControls` and cannot catch a change here. The CSS reasoning above is the evidence
instead. I did not run it.

**Decisions:** none. The design (06 §2.2) was right. The code and its comment were wrong.

**One trap for later readers.** `app/a11y-d148.test.ts` scans source text for the literal
`position: fixed` and requires a token background next to it. A comment containing that phrase in
`map-shell.tsx` failed it, so the comment says "fixed-positioned".

