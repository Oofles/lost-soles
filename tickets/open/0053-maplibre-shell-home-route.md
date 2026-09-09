---
id: 53
slug: maplibre-shell-home-route
title: MapLibre GL JS 6.x shell as the home route, DPR capped at 2
type: feature
priority: high
status: open
size: s
capability: 08-map-and-fog-renderer
depends_on: [16, 52]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

A plain `maplibre-gl@6.6.0` map filling the home route, loading the R2 style from 0052. **No
deck.gl** — R4's evaluation rejected it (`05-fog-of-war.md` §4.6) and a ~500 KB dependency whose
mask extension we would have to fork earns nothing here.

MapLibre 6 is ESM-only and WebGL2-only. The WebGL2 requirement is load-bearing for the fog:
`gl.blendEquation(gl.MAX)` is WebGL2-only and there is no fallback in the design
(`05-fog-of-war.md` §9.6). Establishing the version and confirming WebGL2 on the target phone is
part of this ticket, because discovering it in session five of 0055 would be a schedule event.

`pixelRatio: Math.min(devicePixelRatio, 2)`. A 3× phone gains essentially nothing on a soft mist
effect and costs 2.25× the composite fragments — the cheapest mobile win available.

Camera state (centre, zoom, bearing) persists across reloads in `localStorage` so the operator does
not re-navigate to their neighbourhood on every build. Default camera is the user's most recent
activity centroid, falling back to a configured home coordinate.

Handle `webglcontextlost` / `webglcontextrestored` from the outset: rebuild programs, VAOs and
FBOs. On a phone this fires for real when the tab is backgrounded under memory pressure, and
retrofitting it after the custom layer exists is much harder than allowing for it now.

Chrome is deliberately unstyled beyond the 0016 design tokens. No parchment, no plinth, no ledger
(`09-roadmap.md` §2.3).

## Acceptance criteria

- [ ] `maplibre-gl` pinned to `6.6.0`; the map renders full-bleed on the home route.
      **Half proven.** The pin is exact in `package.json` and the lockfile. *Renders full-bleed*
      needs an eye — operator check 2.
- [x] `pixelRatio` is `Math.min(devicePixelRatio, 2)`.
- [x] The app detects WebGL2 at boot and renders an explicit, readable "this device cannot run the
      map" state instead of a blank canvas if it is absent.
- [ ] `webglcontextlost` is handled — preventDefault, then full rebuild on restore — with a manual
      test using `WEBGL_lose_context`.
      **Built, not yet exercised.** The criterion itself specifies a *manual* test, and it cannot
      be run without a session — operator check 4.
- [ ] Camera position persists across reload; first-ever load centres on the configured home.
      **Unit-tested, not yet observed.** `localStorage` and the session-gated env read are both
      covered by tests, but neither can be exercised from a terminal: the map is behind `AuthGate`,
      so no headless run can reach it — operator checks 5 and 6.
- [x] No deck.gl in the dependency tree (a CI check on the lockfile).
- [ ] Map resize is handled on orientation change without a stretched canvas.
      **Built** (`ResizeObserver` on the container, because MapLibre's `window.resize` listener
      misses both an orientation change that keeps window size briefly identical and the URL bar
      collapsing). Needs a device — operator check 3.
- [x] Bundle size of the map route is recorded in the capability doc as a baseline.

## Notes

MapLibre's `prerender`/`render` custom-layer hooks and the `shaderData.vertexShaderPrelude` that
0055 depends on are version-sensitive. Pinning exactly, and recording the prelude's shape in the
capability doc, is what stops a minor bump from silently breaking projection.

## Operator validation

1. Open the home route on the 6.8in Android phone, outdoors, in direct sunlight, at default
   brightness. The basemap must be legible — if it is not legible *now*, no amount of fog tuning
   later will save it.
2. Pinch-zoom between z12 and z17 and pan hard for 30 seconds. Motion is smooth; nothing tears; the
   canvas fills the viewport with no white gutter at the bottom on the phone's browser chrome.
3. Rotate the phone to landscape and back. The map resizes cleanly, no stretching.
4. Background the browser for a few minutes, then return. The map is still there (or has rebuilt
   itself), not a black rectangle.

## Notes — 2026-09-08, work complete and deployed, awaiting operator checks

**The code is built, deployed and live**; this ticket stays open only because four of its eight
criteria need a browser and a session, and one of them (`WEBGL_lose_context`) says "manual test"
in its own wording. Ticking them from a terminal would be inventing evidence.

**Why a headless run could not stand in.** Chromium is available on this machine, but `/` is
behind `AuthGate` and the agent has no session — a signed-out load never reaches the map at all.
That is confirmed rather than assumed: the smoke test below asserts the signed-out payload
contains no map markup.

**Verified by the agent against the live deploy** (`https://soles.devaultsecurity.com`, Amplify
job 152 `SUCCEED`):

```
PASS  signed-out GET / returns 200
PASS  signed-out / carries no home coordinate
PASS  signed-out / carries no map markup
PASS  maplibre is not referenced in the signed-out HTML
```

The second line is the one worth keeping: it is the live proof of the privacy design below, and
the first version of that check was **silently broken** — `grep -qF "-81.4046"` parsed the leading
minus as an option and errored out while the suite still printed PASS. Fixed with `--`. Two
smoke-test bugs in two tickets now, both the same shape: an assertion that cannot fail is
indistinguishable from one that passes.

**Also verified:** `npm run build` (baseline recorded in the capability doc), the full suite
(1582 passing), all seven gate scripts including the new `check-no-deckgl.mjs`, and the Amplify app
now carries `LOST_SOLES_HOME_LAT` / `_LNG` / `_ZOOM`.

**One risk the operator's first load will settle.** Amplify app-level environment variables are
inherited by the branch, but whether they reach the **SSR runtime** (as opposed to the build) is
not introspectable through any API the agent has. If they do not, `homeCameraForSession()` returns
`null` and the map opens on the Florida-wide fallback instead of Nocatee. **That is the tell**: if
the first load shows the whole state rather than your neighbourhood, the wiring is right and the
variable did not arrive — set it at branch level rather than app level and redeploy.

### Decisions taken while building

- **The home coordinate is a session-gated environment variable, not a constant.** `08 §7.2` and
  D-199 keep the operator's coordinates out of this public repo; `/` being the signed-out landing
  route means it must also stay out of the rendered payload. Full reasoning in the capability doc
  and in `lib/map-home.ts`.
- **A blank env var is treated as unset.** `Number("")` is `0`, which would centre the map on Null
  Island — a valid-looking camera with no tiles under it. The test predicted this in a comment and
  then caught it.
- **The activity-centroid default became ticket `0186`.** `0053`'s Description asks for it; there
  is no client-side activity data before `0054`, so building it here would mean inventing a query
  path `0054` then replaces.
