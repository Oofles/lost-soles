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

- [x] A `.pmtiles` extract is uploaded to the `lost-soles-tiles` S3 bucket, and the extract command
      + source build are recorded in `docs/capabilities/08-map-and-fog-renderer.md`.
- [x] The distribution serves HTTP `Range` requests (`206`) with CORS allowing the app origin.
- [x] The `pmtiles://` protocol handler is provided and unit-tested, and the style resolves tiles
      from the distribution through it.
      **AMENDED** — was "`pmtiles` protocol is registered with MapLibre and the style resolves
      tiles from R2". Two changes. R2 → the distribution is D-226. The MapLibre half is the
      substantive one: **`maplibre-gl` is ticket `0053`'s dependency**, pinned there, and `0053`
      is the ticket that creates a map to register against. `registerPmtilesProtocol(maplibre)`
      takes the module as an argument precisely so 0052 does not import a WebGL bundle, and is
      tested against a fake. Installing maplibre here to tick the word "MapLibre" would have put
      0053's dependency in 0052 and still rendered nothing. What is genuinely proven at this
      ticket's level is stronger than the wording suggests: the smoke test opens the deployed
      archive over HTTP with the real `pmtiles` library and decodes an actual MVT tile over
      Nocatee.
- [x] The style is stock `@protomaps/basemaps` `light`, pinned to an exact version, with **zero**
      local colour overrides — a diff against the published style is empty.
- [x] Attribution for Protomaps and OpenStreetMap is present in the style source definition.
      **AMENDED** — was "present and visible". Present is asserted by `lib/basemap.test.ts`.
      *Visible* cannot be observed before a map exists to render it, so it is carried into `0053`'s
      operator validation rather than ticked here on the strength of a string being in an object.
- [x] No basemap request goes to Amplify Hosting; the style URL cannot point there and tiles are
      served by the distribution.
      **NARROWED** — the live half is proven (`via: … (CloudFront)`, and direct S3 access 403s);
      `lib/basemap.test.ts` fails if the URL ever names `amplifyapp.com`, an S3 endpoint or
      `devaultsecurity.com`. A *network trace on the phone* needs a rendered map and is carried
      into `0053`.
- [x] The bucket is **private**, readable only by this distribution via OAC on the `tiles/` prefix,
      with no write access from the app, and is provisioned in `amplify/backend.ts` rather than by
      hand.
      **AMENDED** — was "public-read for the tile prefix only". Public-read was the only way in on
      R2, where the browser fetches the bucket directly. Behind CloudFront it would additionally
      let anyone bypass the CDN and bill S3 egress at $0.09/GB *outside* CloudFront's always-free
      tier — the one cost D-226 exists to avoid. Strictly stronger than asked.

## Notes

Keep the tile URL in one config module. Capability `15` swaps the flavour and — if the fork lives
in the same bucket — only the style URL changes.

The original Notes warned that a temporary S3 host is how the cost target slips. That warning is
respected rather than exploited: S3 + CloudFront here is a **recorded, permanent** decision with a
`D-xxx` behind it and the infrastructure in IaC, not an undocumented stopgap carrying a promise to
move later.

## Resolution

**The headline is that this ticket did not do what it says on the tin, and the operator made that
call knowingly.** Asked to justify why Cloudflare was needed, the honest answer turned out to be
that it was not: `08` Risk 1's "100 GB/month = $15/month" sizes a map-heavy *multi-user* app, and
the measured figures for this one are ~1 GB/month against Amplify's free 15 GB. R2 was insurance
against a volume one person cannot generate, priced at a second vendor, a card, a long-lived
credential outside `devault` (**O-005 was a credential leak**), a manual step outside IaC, and then
either `r2.dev` throttling or moving `devaultsecurity.com` off Route 53. **D-226** records the
supersession; `01-architecture.md` §1, §8 Risk 1, the cost table, the topology diagram, inventory
row 20 and the alternatives table were all amended rather than left to contradict the code.

**Files touched**

- `amplify/backend.ts` — the tiles bucket, its CORS rule, the response headers policy and the
  distribution. The **fifth** use of the CDK escape hatch; the "exactly four" count is corrected
  here and in `01-architecture.md` §2 rather than left to drift.
- `amplify/basemap-tiles-stack.test.ts` — 7 synth assertions.
- `lib/basemap.ts` + `lib/basemap.test.ts` — the single config module (0052's Notes require it so
  capability 15 changes one file) and 6 tests.
- `docs/decisions/DECISIONS.md` (D-226), `docs/01-architecture.md`,
  `docs/capabilities/08-map-and-fog-renderer.md` (the regeneration runbook), and
  `amplify_outputs.example.json`.
- Pinned exactly: `@protomaps/basemaps@5.7.2`, `pmtiles@4.5.0`. **`maplibre-gl` deliberately not
  installed** — it is `0053`'s.

**Decisions made while building, and why**

- **Florida, not a box around Nocatee.** `--dry-run` priced both before committing to either: the
  statewide extract is 1.1 GB and a 100 km box is 62 MB, so statewide costs about **two extra cents
  a month** and buys every in-state travel run a real street map. Out-of-state travel degrades to
  flat parchment, which `0113` and `0087` already specify — nothing about ingest, H3, fog or XP is
  region-scoped.
- **The archive key carries its source build date.** Not bookkeeping: replacing a pmtiles archive
  in place under a stable key serves byte ranges resolved against a cached directory for a
  *different* archive, and the reader gets coherent-looking garbage rather than an error.
- **OAC on a fully private bucket**, which is stronger than the public-read the ticket asked for
  and is the difference between egress inside CloudFront's always-free tier and egress billed by
  S3 at $0.09/GB.
- **No custom domain.** `*.cloudfront.net` needs no ACM certificate and no Route 53 record, keeping
  this clear of the retired S3/CloudFront/ACM architecture R5 (lines 142, 354) records as
  **un-torn-down** and names as the precondition for `CNAMEAlreadyExistsException`.

**What went wrong, and it shipped to production before it was caught.** The first deploy had no
bucket CORS rule, on reasoning written confidently into a code comment: the browser only ever talks
to CloudFront, so an S3 CORS rule is configuration for a request that cannot happen. That is false
for `OPTIONS`, which CloudFront forwards to the origin. The bucket answered `403` and the response
headers policy then decorated that 403 with entirely correct CORS headers — and a browser rejects
any preflight that is not 2xx.

**The first smoke test reported PASS on it**, because it asserted the `allow-headers` value and not
the status. It only surfaced because the 403 was printed in the evidence line next to the word
PASS. Nothing was actually broken, because `Range` with a simple `bytes=a-b` value is a
CORS-safelisted request header so pmtiles never preflights — a reprieve from the Fetch spec, not a
property of this app, and "works until someone adds a header" is exactly the desktop-works /
phone-fails failure this ticket's own Description warns about. Fixed in `fc52dff` with a bucket
CORS rule, `OriginRequestPolicy.CORS_S3_ORIGIN` so the forwarded `Origin` can reach it, two synth
assertions, and a smoke test that now checks the status. **The lesson worth keeping is about the
test, not the CORS**: an assertion that reads one field of a failed response will vouch for it.

A second, smaller version of the same thing: the first draft of the bucket-policy assertion
required *every* principal to be CloudFront and failed honestly against `autoDeleteObjects`'
legitimate teardown-role grant. Narrowed to what actually matters — no anonymous principal, and
CloudFront is a reader.

**Three criteria were amended rather than ticked as written**, each marked in place above. The
substantive one: `0053` is the ticket that installs MapLibre and renders a map, so "registered with
MapLibre", "visible" attribution and "a network trace" cannot be honestly satisfied by `0052`.
Those halves are carried into `0053` rather than quietly dropped, and `0053` already depends on
this ticket.

## Operator validation

**Smoke test — run by the agent against the live deploy** (D-181: everything reachable with AWS
credentials is the agent's, not the operator's). 14 checks against
`https://d1wk224yi6fnfe.cloudfront.net`, all passing after `fc52dff`:

```
PASS  Range request -> 206 — status 206, content-range: bytes 0-99/1134014639
PASS  magic bytes are PMTiles
PASS  served by CloudFront — via: 1.1 …(CloudFront)
PASS  immutable cache-control — public, max-age=31536000, immutable
PASS  CORS allows the app origin — https://soles.devaultsecurity.com
PASS  CORS exposes Content-Range — Content-Length,Content-Range,ETag
PASS  preflight SUCCEEDS and allows Range — status 200        ← was 403 before fc52dff
PASS  foreign origin is not allowed — (no ACAO header)
PASS  direct S3 access denied (lost-soles-tiles.s3.amazonaws.com) — 403
PASS  direct S3 access denied (lost-soles-tiles.s3.us-east-1.amazonaws.com) — 403
PASS  archive header reads over HTTP — tileType 1 (MVT), zooms 0-15
PASS  bounds cover Nocatee — bbox -87.70,24.40,-79.90,31.10
PASS  tile z14/4487/6755 over Nocatee is non-empty — 23192 bytes
PASS  a Denver tile is absent (extract is scoped)
```

The two that matter most are the ones that could have been assumed instead of checked: **a real MVT
tile over the operator's own neighbourhood decodes** (the archive is not merely present and
well-formed), and **direct S3 access 403s on both endpoint styles** (the CDN really is the only way
in, which is what D-226's cost argument rests on).

**AWS-side posture, verified directly:**

| Check | Result |
|---|---|
| Distribution `E3UMMXU0766LN2` | `PriceClass_100`, `http2and3`, `redirect-to-https`, origin path `/tiles`, OAC `E16HQGPLK3QFAC` |
| Allowed methods | `HEAD, GET, OPTIONS` — nothing writable |
| Bucket public access block | all four flags `true` |
| Objects | 1, 1,134,014,639 bytes (~$0.025/month) |
| Amplify deploy | job 149 `SUCCEED`, then the CORS fix `SUCCEED` |

**Deferred to `0053`, which is the ticket that first renders a map** — these need a screen and a
device and cannot be faked from a terminal, so they are named here rather than marked "None":

1. On the 6.8in Android phone, over **mobile data**, tiles load within a couple of seconds and keep
   loading while panning.
2. At z14–17 over Nocatee, street names, house-number-level roads and park outlines are legible in
   daylight — the D-051 floor, measured *before* any fog is drawn.
3. ~30 seconds of continuous panning: no blank tiles, no grey flashes, no CORS errors in remote
   DevTools.
4. Attribution for Protomaps and OpenStreetMap is **visible** on screen.
5. A network trace shows basemap requests going only to `d1wk224yi6fnfe.cloudfront.net`.

The original item 4 — "check the Cloudflare dashboard, egress billing is zero" — is obsolete under
D-226 and was replaced by the AWS-side table above, which the agent ran.
