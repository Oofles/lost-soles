---
id: 52
slug: pmtiles-basemap-on-r2
title: Protomaps PMTiles basemap on S3 + CloudFront with the stock light flavour
type: feature
priority: high
status: open
size: s
capability: 08-map-and-fog-renderer
depends_on: [12]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-09T01:54:37Z
---

## Description

Host a Protomaps `.pmtiles` extract on a **dedicated public-read S3 bucket behind our own
CloudFront distribution** and point a MapLibre style at it via `pmtiles://`.

> **Amended mid-ticket — see D-226.** As written this ticket specified **Cloudflare R2**, on the
> strength of §8 Risk 1's "100 GB/month = $15/month". That figure sizes a map-heavy *multi-user*
> app. Measured here, the Florida extract is 1.1 GB stored and a busy month moves ~1 GB, which is
> inside Amplify's free 15 GB and would bill ~$0.15/month past it — so R2 was insuring against a
> volume one person cannot generate, at the price of a second vendor, a long-lived credential
> outside `devault`, a manual step outside IaC, and either `r2.dev` throttling or moving DNS off
> Route 53. This ticket takes rung **(b)** of the ladder R5 and §8 already sanction. **The slug
> and filename still say `r2` — filenames are immutable, and a stale slug beats a renumbered
> ticket.**

Map tiles are still the only asset in this app served at map-panning volume, and the rule that
was actually load-bearing is unchanged: **tiles never route through Amplify Hosting**, whose
egress bills at $0.15/GB.

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

- [ ] A `.pmtiles` extract is uploaded to the `lost-soles-tiles` S3 bucket, and the extract command
      + source build are recorded in `docs/capabilities/08-map-and-fog-renderer.md`.
- [ ] The distribution serves HTTP `Range` requests (`206`) with CORS allowing the app origin.
- [ ] `pmtiles` protocol is registered with MapLibre and the style resolves tiles from R2.
- [ ] The style is stock `@protomaps/basemaps` `light`, pinned to an exact version, with **zero**
      local colour overrides — a diff against the published style is empty.
- [ ] Attribution for Protomaps and OpenStreetMap is present and visible.
- [ ] No basemap request goes to Amplify Hosting; a network trace shows tiles only from the
      tiles CloudFront distribution.
- [ ] The bucket is public-read for the tile prefix only, with no write access from the app, and
      is provisioned in `amplify/backend.ts` rather than by hand.

## Notes

Keep the tile URL in one config module. Capability `15` swaps the flavour and — if the fork lives
in the same bucket — only the style URL changes.

The original Notes warned that a temporary S3 host is how the cost target slips. That warning is
respected rather than exploited: S3 + CloudFront here is a **recorded, permanent** decision with a
`D-xxx` behind it and the infrastructure in IaC, not an undocumented stopgap carrying a promise to
move later.

## Operator validation

1. On the 6.8in Android phone, over mobile data (not wifi), open the map route. Tiles must load
   within a couple of seconds and continue loading smoothly while you pan.
2. Zoom to 14–17 over your own neighbourhood. Street names, house-number-level roads and park
   outlines are all present and legible in daylight — this is the legibility floor D-051 demands,
   measured *before* any fog is drawn over it.
3. Pan continuously for ~30 seconds. No blank tiles, no flashes of grey, no CORS errors in remote
   DevTools.
4. Check the Cloudflare dashboard afterwards: requests are hitting R2 and egress billing is zero.
