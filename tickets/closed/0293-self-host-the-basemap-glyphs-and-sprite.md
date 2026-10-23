---
id: 293
slug: self-host-the-basemap-glyphs-and-sprite
title: Self-host the basemap glyphs and sprite
type: chore
priority: high
status: closed
size: s
capability: 18-mvp-hardening
depends_on: [97]
blocked_by: []
source: agent
created: 2026-10-19T13:44:41Z
started: 2026-10-22T05:00:54Z
closed: 2026-10-23T02:15:14Z
---

## Description

The parchment basemap (`0097`) still loads its glyphs (fonts for labels) and sprite (icons) from
`protomaps.github.io`. That breaks `06-ui-ux.md` §9.5's "no third-party requests at runtime", and
predates `0097`. Without them, labels vanish on a cold cache or offline. Adventure's paper grain
(05 §5.2) also needs our own sprite, so it was not built in `0097`.

## Acceptance criteria

- [x] Glyph PBFs and the sprite the style references are served from this project's own origin or the tiles CloudFront distribution (D-226), never a third party.
- [x] A test fails if the built style names `protomaps.github.io` or any other third-party host.
- [x] Labels render in both variants on the deployed app with the browser's network panel showing no third-party font or sprite request. — verified 2026-10-22: operator, desktop browser, adventure and `?basemap=atlas`; looks the same, no third-party request.
  *Not tickable before deploy.* Locally: `tools/fog-harness/tune.mjs` rendered both variants off the real archive with labels, POI icons and shields drawn from the self-hosted files, and `next start` served a glyph range and the sprite at 200 with no redirect. The deployed check is the post-deploy smoke test plus the operator's look below.

## Notes

Proposed by the `0097` agent (wave 1 of capability 15). Upstream: `@protomaps/basemaps` 5.7.2.
Only the font stacks and sprite the fork actually uses need hosting.

**2026-10-22 — raised to `high`** (wave-18 planning): `0113` (high) now depends on it, and `0112` (high) on `0113`.

## Operator validation

Desktop browser: labels in adventure and `?basemap=atlas` look the same as before the change.

**Result, 2026-10-22, after Amplify job 426 deployed `88a6798`:**

- **Operator, desktop browser:** in `/` (adventure) and `/?basemap=atlas`, street names, water labels, POI icons and road shields look the same as before. The network panel shows font and sprite requests only to `soles.devaultsecurity.com/basemap-assets/`, none to `protomaps.github.io`.
- **Smoke test (orchestrator):**
  - All 8 sampled asset URLs return 200: three font stacks at 0-255, Regular 8192-8447, and `light`/`light@2x` `.json`/`.png`.
  - The pbfs are `application/octet-stream`. Regular 0-255 is 76,044 bytes and `light.json` is 3,549 bytes, exactly as the agent predicted.
  - No JS chunk on the deployed `/` names `protomaps.github.io`.
- D-123 trigger checked? none.

## Resolution

**Hosted on the app's own origin, as committed static files.** `public/basemap-assets/` holds what
the shipped style references and nothing else (D-373: stock `light`, no paper grain, so no sprite of
our own): `fonts/Noto Sans {Regular,Medium,Italic}/` — all 256 glyph ranges each — plus `OFL.txt`,
and `sprites/v4/light{,@2x}.{json,png}`. 773 files, ~14 MB on disk. Copied from
`protomaps/basemaps-assets` at `028c18f7` (2025-10-31); every file sampled against the public host
was byte-identical, so the rendering is unchanged by construction. `NOTICE.txt` carries provenance and
the OFL/MIT licences. The font stacks were read off the built style of both variants, not assumed:
three stacks, one of them inside a `case` expression; the sprite serves `pois`, the locality dots,
and atlas's shields and one-way arrows.

Not the tiles distribution: it fronts a private bucket (D-250), so it would mean an S3 upload outside
the deploy. The app origin ships with the build and needs no AWS step.

**All 256 ranges, not R4's "Latin 0–511 only".** Glyph ranges are fetched only when a label draws a
codepoint in them, so unused ranges cost disk, not requests. Shipping fewer would turn any name with
an en dash, a curly quote (range 8192–8447) or a non-Latin character into a 404 and a missing label.

**Files touched**
- `public/basemap-assets/**` — the glyphs, sprite, `OFL.txt`, `NOTICE.txt` (new).
- `lib/basemap.ts` — `BASEMAP_ASSETS_PATH`, `basemapAssetsBase(origin)`; `basemapStyle(variant,
  origin?)` points `glyphs`/`sprite` at it. Absolute in a browser because MapLibre rejects a relative
  `sprite` (`normalizeSpriteURL`: "must be absolute"); root-relative where there is no http(s) page
  origin (node tests, `file://` harnesses).
- `lib/style-requests.ts` (new) — `styleRequestUrls(style)` lists every URL a style makes MapLibre
  fetch (glyphs, sprite string or array, each source's `url`/`tiles`/`urls`/string `data`, with
  `pmtiles://` unwrapped); `thirdPartyRequestHosts(style, firstPartyOrigins)` returns any host
  outside the allowlist. Request-bearing fields only: the attribution's `<a href>` credits are links,
  never fetched, and allowlisting them would be how a real third-party request later slipped in.
  Built for `0113` to reuse.
- `lib/basemap.test.ts` — both variants name no third-party host against `[app, tiles]`; the URLs
  are the app origin's; root-relative with no origin; the check flags a third-party glyph, sprite,
  pmtiles and protocol-relative tile host (the pre-0293 style fails it); every font stack any layer
  names has all 256 ranges on disk and both sprite densities exist.
- `middleware.ts`, `middleware.test.ts` — `basemap-assets/` exempt from the matcher, as `/maplibre/`
  is. Without it every `.pbf` and the sprite `.json` took a 307 to `/` (the `.png` was already exempt
  by extension) — the 0053 worker bug again, as missing labels.
- `tools/fog-harness/tune.mjs` — symlinks `public/basemap-assets` into its served workdir.
- `docs/08-security-privacy.md` §5.3 Headers row — the CSP no longer needs a font/sprite host.

**Not done (scope).** No long-lived `Cache-Control` on `/basemap-assets/`: Next serves `public/` with
revalidation, which is correct for an unversioned path. Offline label rendering beyond the browser's
HTTP cache would need a service worker, which no ticket asks for.

