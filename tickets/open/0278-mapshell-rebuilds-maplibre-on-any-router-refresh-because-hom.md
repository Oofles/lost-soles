---
id: 278
slug: mapshell-rebuilds-maplibre-on-any-router-refresh-because-hom
title: MapShell rebuilds MapLibre on any router.refresh(), because home is compared by object identity
type: bug
priority: low
status: open
size: s
capability: 13-home-plinth-and-chronicle
depends_on: []
blocked_by: []
source: agent
created: 2026-10-15T20:21:36Z
---

## Description

`MapShell`'s build effect (`components/map/map-shell.tsx:385`) depends on `[home, framed]`. `home`
is a `Camera` object passed down from the server, so every `router.refresh()` while `/` is mounted
delivers a new object with the same values. The effect re-runs and tears down and rebuilds MapLibre.
Today nothing refreshes while the map is mounted: `0276` (D-331) holds the app's children during
its auth refresh for exactly this reason. Any future refresh after a server action would rebuild the map,
though, and the hold in D-331 is partly a workaround for this.

## Acceptance criteria

- [ ] The build effect re-runs only when `home`'s lat, lng or zoom (or `framed`) actually change,
      not when a value-equal `home` object arrives.
- [ ] A test renders `MapShell` (or its effect's dependency derivation), then passes a new `home`
      object with the same values, and asserts the map is not rebuilt. A changed value still rebuilds.

## Steps to reproduce

1. Signed in, on `/`, with the map loaded.
2. Trigger `router.refresh()` (for example from the console via a test hook, or a future server
   action that refreshes).

## Expected vs actual

**Expected:** the map stays as it is; only server props update.

**Actual:** MapLibre is destroyed and rebuilt, and the camera and fog layers re-initialise.

## Notes

Found by the `0276` agent, wave 2 of capability `13`. Low priority because no current path
refreshes with the map mounted. Once fixed, D-331's hold can stay. It also protects the `uid` swap.

## Operator validation

None expected: the test proves it; nothing about it is perceptual.
