---
id: 313
slug: fog-layer-waits-for-every-visible-tile-before-it-can-draw
title: Fog layer waits for every visible tile before it can draw
type: bug
priority: med
status: open
size: s
capability: 08-map-and-fog-renderer
depends_on: []
blocked_by: []
source: agent
created: 2026-10-23T02:39:32Z
---

## Description

06-ui-ux.md §4.8 says the fog never waits on tiles. But useFogMask adds the fog layer only after MapLibre's load event, and load fires only once every visible tile has arrived or failed. On a slow connection the fog therefore cannot draw until the basemap has finished loading. Offline, tile requests fail fast, so it does not bite there. Found by the 0113 agent (wave 18.2). Not fixed there: it is renderer work, and it touches D-333's hold.

## Acceptance criteria

- [ ] The fog layer is added as soon as the style is ready and the explored set is known. It does not
      wait for tiles, so on a throttled connection the fog draws before the basemap tiles finish.
- [ ] A test with tile requests that never resolve asserts that the fog layer is still added.
- [ ] D-333's hold (pending, and keeping the last frame) and D-439's paint gate still behave as
      recorded. If moving the layer changes when the gate opens, say so in the Resolution.

## Steps to reproduce

1. Open `/` with warm IndexedDB and DevTools throttling set to Slow 3G (or in a test, delay the
   tile responses).
2. Watch when the fog appears relative to the basemap tiles.

## Expected vs actual

**Expected:** the fog draws from the cached explored set right away, over flat background where tiles are missing (06 §4.8).

**Actual:** the fog appears only after MapLibre's `load`, which waits for every visible tile to arrive or fail.

## Notes

Reported by the `0113` agent and not verified in a browser yet; confirm `load`'s timing against the MapLibre version in use before changing anything.

## Operator validation

Covered by a test with delayed tiles. Perceptual check only if the fix changes how the fog arrives on `/`.

D-123 trigger checked? none.
