---
id: 101
slug: map-controls-and-run-inspection
title: Map controls, gestures, and inspecting a past run over the fog
type: feature
priority: med
status: open
size: m
capability: 15-two-map-modes-and-cold-territory
depends_on: [98, 90]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The full gesture and control set for the map screen (`06-ui-ux.md` §4.4) and the run-inspection
interaction (§4.5).

Input, per D-253 (mouse and keyboard; supersedes §4.4's touch table):

| Input | Does |
|---|---|
| Drag | Pan, inertia on, rubber-band at bounds |
| Wheel / trackpad pinch | Zoom anchored at the cursor, z10 → z18 |
| Double-click | Zoom in one step, anchored at the cursor |
| Arrow keys / `+` `−` | Pan / zoom one step |
| Toggle control (top-left) or its shortcut | Toggle atlas / adventure (0098) |
| Click on a route line | Inspect that run, 24 px hit slop |
| **Click on empty map** | **Nothing — deliberate** |
| Click `⌖` | Recentre on the last run's end point, z14 |
| Click the fit-territory control (small, next to `⌖`) | Fit the whole territory in view |
| Drag the plinth handle up | Chronicle sheet |

~~Two-finger tap → zoom out one step~~ and the wet-screen multi-contact rule are dropped *(D-253)*.

**Rotation and tilt are disabled; bearing locked north-up, pitch locked to 0.** A rotated street
map with no compass is a map you cannot navigate by, and a compass is a control that exists only
to undo an accident. Tilt buys nothing without 3D buildings and costs label legibility at the
horizon. D-051 decides both.

**Zoom bounds z10–z18**, both rubber-banding rather than hard-stopping. Below z10 the fog's zoom
bucketing coarsens territory into a smear that misrepresents what has been explored; above z18 the
basemap has nothing left to show.

**Clicking empty map does nothing, on purpose.** A cell inspector ("you last ran here 211 days
ago") is a stats organ that turns the map into a database browser. The one piece of that
information that helps a decision is rediscoverability, and 0100 shows it as colour instead of
hiding it behind a click.

**Three route layers, all above the fog** (05 §4.4): the accumulated trace web, the selected run,
and the live corridor. On `/` the trace web is always drawn and the last run is selected; on
`/run/:id` the web dims to 0.18 beneath the selected run. Route colour is fixed — warm cream core
`#fff2d0` with an amber `#ffb347` glow — because it is the one combination that survives both
parchment and near-black fog. Pure white blows out on parchment; pure red disappears into it.

Inspecting: click within 24 px of a line. One match → highlight immediately and show a one-line
chip (date · distance · new cells) clicking through to `/run/:id`. Multiple matches → a
disambiguation card anchored above the click point, flipping below near the top edge, 48 px rows,
five rows then scrolls, never a full sheet.

## Acceptance criteria

- [ ] Every row of the §4.4 table is implemented and covered by an interaction test, including
      "click on empty map does nothing" asserted as no navigation, no sheet, no state change.
- [ ] `map.getBearing() === 0` and `getPitch() === 0` after right-drag / Ctrl-drag (MapLibre's
      dragRotate and pitch handlers); rotation and tilt handlers are disabled at the map options
      level, not swallowed in a listener.
- [ ] Zoom clamps to [10, 18] with rubber-band overshoot that settles back; a test asserts the
      settled zoom is within bounds after an over-zoom in both directions.
- [ ] Click within 24 px of exactly one route line selects it and shows the one-line chip; click
      with three lines within 24 px shows the card with three 48 px rows in date-descending order.
- [ ] The card flips to below the click point when the click is within its own height of the top
      edge.
- [ ] Route layers render above the fog in both modes, with the tabled per-mode opacities; on
      `/run/:id` the trace web is at 0.18.
- [ ] Route colours are the fixed cream/amber pair, read from one constant, not per-mode palette.

## Notes

~~The long-press is doing double duty (mode toggle on empty map, nothing on a route line). Resolve
by hit-testing the route layers first: a long-press that begins on a route line within 24dp is a
press on that line and must not toggle modes, or planning users will flip modes by accident every
time they hesitate over a route.~~ *(Superseded by D-253: the mode toggle is a control, not a map
gesture, so there is no double duty.)*

~~`06-ui-ux.md` §9.6 requires multi-contact taps to be treated as pans (wet screen). That
interaction rule belongs to 0112 but it interacts with the two-finger tap for zoom-out — implement
two-finger tap with a tight time and movement threshold so a wet palm reads as a pan.~~ *(D-253:
two-finger tap and the wet-screen multi-contact rule are dropped.)*

## Operator validation

In the desktop browser, on `/`: pan, wheel-zoom, double-click, use the keyboard, hit `⌖` and the
fit-territory control (confirm the whole territory fits). Try to rotate or tilt (right-drag,
Ctrl-drag) — it must not budge. Click where several runs overlap: the card appears above the
cursor with all three dates readable; repeat at the top edge and confirm it flips below.
