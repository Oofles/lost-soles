---
id: 98
slug: atlas-adventure-toggle
title: The atlas / adventure toggle — uniforms, style variants, 320 ms cross-fade
type: feature
priority: high
status: open
size: m
capability: 15-two-map-modes-and-cold-territory
depends_on: [97, 59]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Implement the D-052 two-mode toggle: **atlas** (high legibility, for deciding where to run
tomorrow) and **adventure** (full atmosphere, for looking at what you have done).

Mechanically the toggle is a **shader-uniform swap plus a style-variant swap, entirely
client-side**, with no path back to scoring (05 §5.4). Values are fixed by 05 §5.2 and are not a
palette opinion:

| | Atlas | Adventure |
|---|---|---|
| `u_maxOpacity` | 0.55 | 0.94 (never 1.0) |
| `u_noiseAmp` | 0.10 | 0.30 |
| `u_time` | frozen at 0 (noise animation off) | 30 fps drift |
| `u_rimAmt` | 0.08 | 0.30 |
| `u_fogDeep` / `u_fogEdge` | (0.10,0.11,0.14) / (0.30,0.32,0.36) | (0.035,0.045,0.075) / (0.22,0.24,0.30) |
| Mask FBO scale | 0.75× | 0.5× |
| Route polyline | thin, precise, above everything | cream core + amber glow (06 §4.5) |

**Transition: a uniform 320 ms cross-fade, and the camera does not move.** Centre, zoom, bearing
and pitch are byte-identical before and after the toggle. The two renders are cross-faded over
320 ms with a single shared easing curve — every uniform, every layer, one timeline — so nothing
in the frame appears to arrive before anything else. A staggered fade reads as territory
changing, which 0099 forbids outright.

Entry point is **long-press (350 ms) anywhere on the map, with a haptic tick** (06 §4.4). Default
is **adventure** — it is the product's identity. State persists in `localStorage`: it is a
per-device viewing preference, not user data, and it is not synced. The first time the user opens
a route-planning surface, the app suggests atlas once.

Under `prefers-reduced-motion` or battery saver, adventure falls back to atlas's **static** fog
while keeping adventure's colours (05 §5.2 last row), and the rAF loop stops — that is a §9 MVP
definition-of-done box, checked again in 0112.

## Acceptance criteria

- [ ] Long-press (350 ms) on the map toggles modes and fires one haptic tick; a short press does
      nothing (06 §4.4, "tap on empty map does nothing").
- [ ] A test asserts `map.getCenter()`, `getZoom()`, `getBearing()` and `getPitch()` are exactly
      equal before and after a toggle, at three different zoom levels.
- [ ] The cross-fade is 320 ms ± 16 ms, measured, and every uniform and layer opacity animates on
      the same timeline — asserted by sampling interpolation progress at t=160 ms across all
      animated values and requiring a single shared value.
- [ ] Every uniform in the §5.2 table takes exactly the tabled value in each mode; the values live
      in one exported constant map, asserted by a snapshot test against the table.
- [ ] `u_maxOpacity` never exceeds 0.94 in any mode — a unit test on the constant map.
- [ ] Mode survives a reload from `localStorage`; a fresh profile with no stored value gets
      adventure.
- [ ] With `prefers-reduced-motion: reduce`, adventure renders static fog in adventure colours and
      the rAF loop is not scheduled (asserted by a spy on `requestAnimationFrame`).

## Notes

There is no toggle button in the chrome in v1: the long-press is the affordance, and it is
discoverable because the app suggests it once. Adding a floating toggle button means adding
floating chrome, which D-148 requires to be opaque and which competes with the plinth.

The 320 ms figure is deliberately slower than a UI transition and deliberately faster than an
animation you wait for: long enough to read as one continuous surface changing character, short
enough that a planning user toggling twice does not feel taxed.

## Operator validation

On the Android phone, on `/`, park the map over a frontier where explored ground meets fog with a
recognisable street feature crossing the boundary. Long-press to toggle, watching that feature.
Nothing may translate, scale or jump; the fog changes character in place. Toggle back and forth
five times quickly and confirm the map never drifts. Then enable Android's "Remove animations"
accessibility setting and confirm the adventure fog stops moving but stays adventure-coloured.
