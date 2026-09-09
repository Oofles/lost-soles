---
id: 53
slug: maplibre-shell-home-route
title: MapLibre GL JS 6.x shell as the home route, DPR capped at 2
type: feature
priority: high
status: closed
size: s
capability: 08-map-and-fog-renderer
depends_on: [16, 52]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
closed: 2026-09-09T21:22:00Z
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

- [x] `maplibre-gl` pinned to `6.6.0`; the map renders full-bleed on the home route.
      — verified 2026-09-09: operator, desktop browser and phone. "Street map did appear… loads
      perfectly on my phone (landscape and vertical)."
- [x] `pixelRatio` is `Math.min(devicePixelRatio, 2)`.
- [x] The app detects WebGL2 at boot and renders an explicit, readable "this device cannot run the
      map" state instead of a blank canvas if it is absent.
- [x] `webglcontextlost` is handled — preventDefault, then full rebuild on restore — with a manual
      test using `WEBGL_lose_context`.
      — verified 2026-09-09: operator ran the `loseContext()`/`restoreContext()` snippet in the
      desktop console. "2 worked successfully and reloaded with the map."
- [x] Camera position persists across reload; first-ever load centres on the configured home.
      — verified 2026-09-09: persistence confirmed on the first pass ("on refresh it cached where I
      was at before"). The home default took three attempts and was confirmed last: "It opened on
      Nocatee at street level."
- [x] No deck.gl in the dependency tree (a CI check on the lockfile).
- [x] Map resize is handled on orientation change without a stretched canvas.
      — verified 2026-09-09: operator, phone, landscape and portrait.
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

## Notes — 2026-09-09, the map was grey; two worker faults, both fixed and deployed

Reported: grey screen on desktop and phone. Console: *"Failed to load module script: The server
responded with a non-JavaScript MIME type of `text/html`."*

`#cccccc` is the `light` flavour's **background layer**, so the map had constructed and the style
had loaded — no tile was ever parsed. Root causes, both on the worker's path (full write-up in
`docs/capabilities/08-map-and-fog-renderer.md`):

1. MapLibre 6 derives its worker URL from `import.meta.url`; webpack inlines that as a build-machine
   `file://` path, so MapLibre's `if (!/^https?:/.test(t)) return ""` guard produced an **empty**
   worker URL and the browser fetched the page's own HTML.
2. `/maplibre/` was not exempt from `middleware.ts`'s matcher, so the worker took a `307` to `/`.

Fixed in `4bc8c6f`, deployed (job SUCCEED). Verified against the live site:

```
PASS  maplibre-gl-worker.js serves 200, text/javascript
PASS  maplibre-gl-shared.js serves 200, text/javascript
PASS  the worker imports the .js sibling, not .mjs
PASS  signed-out / carries no home coordinate / no map markup
```

**Correction to the previous note:** it claimed `addProtocol` throws on a second registration and
that the context-loss rebuild therefore had a bug. Tested rather than assumed — MapLibre 6 silently
replaces. There is no such bug and nothing was changed for it.

**Still unverified, and still the operator's:** everything that needs a session and a screen. The
worker now loads, but whether the map *renders legibly* is the reason those criteria are unticked.

## Resolution

**This ticket shipped visibly broken and took four deploys to finish.** The record below is what
happened, not what was planned.

**What was built.** `maplibre-gl` pinned to exactly `6.6.0`, mounted as the home route via
`components/map/map-shell.tsx`; the library is imported inside the mount effect so the WebGL bundle
never enters the server render or First Load JS (`/` grew ~19 kB rather than ~139 kB gzipped).
WebGL2 is detected before construction with an explicit unsupported state, `pixelRatio` capped at 2,
camera persisted to `localStorage` with every field validated on the way back in, `ResizeObserver`
on the container, and a full teardown-and-rebuild on `webglcontextrestored`.

**Files touched:** `components/map/map-shell.tsx`, `lib/map-camera.ts` (+ tests),
`lib/map-home.ts` (+ tests), `app/page.tsx`, `middleware.ts` (+ matcher tests),
`next.config.ts`, `amplify.yml`, `.github/workflows/gate.yml`, and three new scripts —
`check-no-deckgl.mjs`, `copy-maplibre-worker.mjs`, `check-home-not-in-client.mjs`.

### Fault 1 — the map was grey, and the cause was two faults deep

Deployed, it rendered a flat grey screen on every device. `#cccccc` is the Protomaps `light`
flavour's **background layer**, so the map had constructed and the style had loaded; no tile was ever
parsed. The console said *"Failed to load module script: non-JavaScript MIME type text/html"*.

Two independent faults, both on the worker's path, either sufficient alone:

1. MapLibre 6 derives its worker URL from `import.meta.url`, which webpack inlines at build time as
   a `file://` path. MapLibre's own guard is `if (!/^https?:/.test(t)) return ""`, so the URL became
   the empty string and the browser fetched the page's own HTML.
2. `/maplibre/` was not exempt from `middleware.ts`'s matcher, so the worker took a `307` to `/`.
   A worker is fetched as a subresource; a redirect is not an answer.

Fixing only the first would have shipped a second grey deploy. The local check caught the second.

**Nothing in the symptom pointed at a worker.** It was found by eliminating everything checkable
from a terminal — the archive, the protocol handler with MapLibre 6's exact signature, the deployed
bundle's URL, the style↔data layer contract, the sprite and glyph URLs — until only the client
runtime remained. Every one of those was correct.

### Fault 2 — the camera opened on the whole of Florida

Amplify environment variables reach the build container but **not the SSR compute runtime**.
App-level failed; branch-level failed identically; `.env.production` failed too, because an App
Router server component's `process.env` read happens at request time and Next only statically
replaces `NEXT_PUBLIC_*` on its own. `next.config.ts`'s `env` fixed it by replacing the reference
during the build. The full table is in the capability doc.

That inlining follows the reference wherever it appears, so `scripts/check-home-not-in-client.mjs`
now scans `.next/static` in the Amplify build and fails on a leak — the reasoning about why the
inlining is safe is a control rather than a comment.

### What I got wrong about my own work

- **Three assertions shipped that could not fail.** `0052`'s CORS check read the preflight's
  headers and ignored its `403`; the leak check's `grep -qF "-81.4046"` had its leading minus parsed
  as an option and errored on every run while printing PASS; and a bundle comparison piped
  `grep -rl` into `head`, masking the exit status so both branches reported success. Written up in
  the capability doc as one pattern rather than three incidents, because it is one.
- **I claimed `addProtocol` throws on re-registration** and that the context-loss rebuild was
  therefore buggy. Tested rather than assumed: MapLibre 6 silently replaces. No such bug.
- **A stale `next start` cost twenty minutes** — the middleware fix looked ineffective because an
  older server still held the port. Verify what is running, not what was built.

### Scope held

The activity-centroid camera default in the Description became ticket `0186`; there is no
client-side activity data before `0054`, so building it here would have invented a query path
`0054` replaces. `maplibre-gl` was left out of `0052` for the same reason it belongs here.

D-227 was recorded during this ticket's validation, superseding half of D-124: the desktop browser
is the primary **viewing** surface. It changes no code here, and `0187` carries the `06-ui-ux.md`
design pass.

## Operator validation

**Operator, 2026-09-09, desktop browser (primary surface per D-227) and Android phone.**

| Check | Result |
|---|---|
| Map renders full-bleed | **Pass.** "Street map did appear." |
| Legible at neighbourhood zoom | **Pass.** "Zooming in to my neighborhood worked great." |
| Camera persists across reload | **Pass.** "On refresh it cached where I was at before." |
| Phone, portrait and landscape | **Pass.** "Loads perfectly on my phone (landscape and vertical)." |
| Attribution visible | **Pass.** Protomaps + OpenStreetMap. |
| `WEBGL_lose_context` rebuild | **Pass.** Ran the console snippet; "worked successfully and reloaded with the map." |
| First-ever load centres on home | **Pass, after three attempts.** "It opened on Nocatee at street level." |

**Agent smoke test against the live deploy** (`https://soles.devaultsecurity.com`, job 158
`SUCCEED`), 9 checks, all passing:

```
PASS  signed-out GET / returns 200
PASS  signed-out / carries no home coordinate
PASS  signed-out / carries no map markup
PASS  maplibre is not referenced in the signed-out HTML
PASS  maplibre-gl-worker.js serves 200, text/javascript
PASS  maplibre-gl-shared.js serves 200, text/javascript
PASS  the worker imports the .js sibling, not .mjs
```

**And from inside the Amplify build container**, where the values actually exist:

```
check-home-not-in-client: 2 value(s) scanned, none in .next/static
```

That last line is the privacy property of D-199 / `08` §7.2 verified against the deployed bundle
rather than asserted in a comment.
