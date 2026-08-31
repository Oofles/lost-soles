---
id: 52
slug: pmtiles-basemap-on-r2
title: Protomaps PMTiles basemap on Cloudflare R2 with the stock light flavour
type: feature
priority: high
status: open
size: s
capability: 08-map-and-fog-renderer
depends_on: [12]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Host a Protomaps `.pmtiles` extract on **Cloudflare R2** and point a MapLibre style at it via
`pmtiles://`. R2 exists in this architecture for exactly one reason — **zero egress**
(`01-architecture.md` §1, §8 Risk 1). A basemap on S3 + CloudFront is the one line item that can
push past the D-083 "few dollars a month" target on its own, because map tiles are the only asset
in this app served at map-panning volume.

**The style is `@protomaps/basemaps` stock `light` flavour, unmodified.** The parchment fork is
capability `15`/1, deliberately after the milestone (`09-roadmap.md` §8.2). Colour work must never
delay the reveal, and the fork is a colour-table edit that can happen any time afterwards. Do not
gold-plate this: the fog is the hard part, the ground underneath it is generic on purpose, and
that is stated in §2.3 as "present but ugly", not as a defect.

Scope the extract to the region the operator actually runs in plus a generous margin, and record
the extract command in the capability doc so it can be regenerated when the region changes.

`pmtiles` range requests need CORS on the bucket and a `Range`-friendly cache policy; getting this
wrong shows up as tiles that load on desktop and fail on the phone.

## Acceptance criteria

- [ ] A `.pmtiles` extract is uploaded to an R2 bucket, and the extract command + source build are
      recorded in `docs/capabilities/08-map-and-fog-renderer.md`.
- [ ] The bucket serves HTTP `Range` requests with CORS allowing the app origin.
- [ ] `pmtiles` protocol is registered with MapLibre and the style resolves tiles from R2.
- [ ] The style is stock `@protomaps/basemaps` `light`, pinned to an exact version, with **zero**
      local colour overrides — a diff against the published style is empty.
- [ ] Attribution for Protomaps and OpenStreetMap is present and visible.
- [ ] No basemap request goes to S3 or CloudFront; a network trace shows tiles only from R2.
- [ ] The R2 bucket is public-read for the tile prefix only, with no write access from the app.

## Notes

Keep the tile URL in one config module. Capability `15` swaps the flavour and — if the fork lives
in the same bucket — only the style URL changes.

If R2 setup stalls for any reason, a temporary S3-hosted extract reaches the milestone and gets a
ticket to move; but flag it loudly, because "temporary" hosting is how the cost target slips.

## Operator validation

1. On the 6.8in Android phone, over mobile data (not wifi), open the map route. Tiles must load
   within a couple of seconds and continue loading smoothly while you pan.
2. Zoom to 14–17 over your own neighbourhood. Street names, house-number-level roads and park
   outlines are all present and legible in daylight — this is the legibility floor D-051 demands,
   measured *before* any fog is drawn over it.
3. Pan continuously for ~30 seconds. No blank tiles, no flashes of grey, no CORS errors in remote
   DevTools.
4. Check the Cloudflare dashboard afterwards: requests are hitting R2 and egress billing is zero.
