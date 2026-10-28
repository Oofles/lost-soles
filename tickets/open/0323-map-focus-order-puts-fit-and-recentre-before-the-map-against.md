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

- [ ] `<MapControls>` follows the map container in the DOM, so Tab order is
      `⚙ → jump-to → the map → fit → ⌖`, as §2.2 states. CSS keeps their position unchanged at
      every width, including the D-448 row below 1024px.
- [ ] A test asserts the DOM order of jump-to, the map container, fit and `⌖`.
- [ ] The comment at `map-shell.tsx:726` states the whole order.

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
