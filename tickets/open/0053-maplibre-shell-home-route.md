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
- [ ] `pixelRatio` is `Math.min(devicePixelRatio, 2)`.
- [ ] The app detects WebGL2 at boot and renders an explicit, readable "this device cannot run the
      map" state instead of a blank canvas if it is absent.
- [ ] `webglcontextlost` is handled — preventDefault, then full rebuild on restore — with a manual
      test using `WEBGL_lose_context`.
- [ ] Camera position persists across reload; first-ever load centres on the configured home.
- [ ] No deck.gl in the dependency tree (a CI check on the lockfile).
- [ ] Map resize is handled on orientation change without a stretched canvas.
- [ ] Bundle size of the map route is recorded in the capability doc as a baseline.

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
