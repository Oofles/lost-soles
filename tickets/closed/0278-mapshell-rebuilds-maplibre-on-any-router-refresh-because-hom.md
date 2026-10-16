---
id: 278
slug: mapshell-rebuilds-maplibre-on-any-router-refresh-because-hom
title: MapShell rebuilds MapLibre on any router.refresh(), because home is compared by object identity
type: bug
priority: low
status: closed
size: s
capability: 13-home-plinth-and-chronicle
depends_on: []
blocked_by: []
source: agent
created: 2026-10-15T20:21:36Z
started: 2026-10-16T00:55:18Z
closed: 2026-10-16T01:20:58Z
---

## Description

`MapShell`'s build effect (`components/map/map-shell.tsx:385`) depends on `[home, framed]`. `home`
is a `Camera` object passed down from the server, so every `router.refresh()` while `/` is mounted
delivers a new object with the same values. The effect re-runs and tears down and rebuilds MapLibre.
Today nothing refreshes while the map is mounted: `0276` (D-331) holds the app's children during
its auth refresh for exactly this reason. Any future refresh after a server action would rebuild the map,
though, and the hold in D-331 is partly a workaround for this.

## Acceptance criteria

- [x] The build effect re-runs only when `home`'s lat, lng or zoom (or `framed`) actually change,
      not when a value-equal `home` object arrives.
- [x] A test renders `MapShell` (or its effect's dependency derivation), then passes a new `home`
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

No perceptual check: nothing in the app refreshes with the map mounted today, so there is nothing to see. `cameraKey` and the build-effect tripwire prove the fix. The local gate on merged `main` passed. Smoke test by the orchestrator after the wave 3 deploy (2026-10-15): Amplify job for `86b9924` (which carries this ticket's commit) finished `SUCCEED`; `curl` on the live app gave `/` → 200, `/chronicle` → 307 to sign-in with no session, and `/api/runs/latest` and `/api/fog/update` → 404 with no session, which is these routes' designed concealing answer to an unauthenticated request (unchanged this wave). The minified bundle carries no literal distinctive enough to grep, so the job record is the deploy evidence.

## Resolution

The build effect is now keyed on home's value instead of its identity.

**Files touched**

- `lib/map-camera.ts`: new `cameraKey(camera: Camera | null): string`. It returns `"none"` for null,
  otherwise `lng,lat,zoom,bearing`. It is a primitive, so React's `Object.is` dependency check
  compares by value.
- `components/map/map-shell.tsx`: `homeKey = cameraKey(home)` and a `fixedHome` ref (the same
  pattern as `fixedRun`). The build effect reads `home` from the ref and depends on
  `[homeKey, framed]` instead of `[home, framed]`. Nothing else changed, and the `held` logic was
  not touched (D-331's hold stays, per the Notes).
- `lib/map-camera.test.ts`: `cameraKey` is equal for a new, value-equal `home` (and for null to
  null). It differs when lng, lat, zoom or bearing changes, and when home appears or goes.
- `components/map/map-shell-build.test.ts` (new): a source tripwire. The effect that constructs
  `new lib.Map(` must end in `}, [homeKey, framed])`, and `homeKey` must come from `cameraKey(home)`.

**Decisions and why**

- **A derived primitive key, not a deep-compare hook or `useMemo` on the object.** It is one line,
  needs no new dependency, and passes the exhaustive-deps lint as written. The effect body reads
  the current object through a ref. That is safe because the ref is only read when the key changes,
  and a key change means the values the effect uses changed too.
- **Bearing is in the key.** The criterion names lat, lng and zoom. `Camera` also carries
  `bearing`, and the map opens on it, so a different bearing is a different home. A value-equal
  object still gives an equal key, so the criterion holds either way.
- **How criterion 2 is met.** The vitest environment is `node`, with no DOM, and effects do not run
  (see `use-latest-run.test.ts`). So `MapShell` cannot be rendered with its effect driven. The
  criterion allows testing "its effect's dependency derivation". That is the `cameraKey` test,
  plus the tripwire that the effect is actually keyed on it.
