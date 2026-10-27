---
id: 321
slug: api-runs-web-is-sent-uncompressed-and-413s-past-5-9-mb-raw
title: /api/runs/web is sent uncompressed and 413s past ~5.9 MB raw
type: chore
priority: low
status: open
size: m
capability: 12-post-run-moment
depends_on: []
blocked_by: []
source: agent
created: 2026-10-27T01:39:35Z
---

## Description

Measured by `0320` (D-460). Amplify compute refuses a response whose raw body passes about 5.94 MB: 5,936,087 bytes returned 200, about 6.03 MB returned 413 with an empty body, whatever `Accept-Encoding` the client sent. Route-handler JSON is also never compressed in transit (no `Content-Encoding` even when gzip or br is asked for), so D-451's "1.13 MB transferred, gzipped in transit" does not hold in production. `/api/runs/web` is sent and capped raw.

Today 113 runs are 316 KB raw (~2.8 KB a run), so the cap arrives near **2,100 runs** at current density. At D-451's realistic density (~30 pts/km, 8 km runs) it arrives near **1,000 runs**, and near ~300 at the noisy ~96 pts/km. Past it, the trace web stops loading: a 413, not a slow load.

## Acceptance criteria

- [ ] `/api/runs/web`'s compute output stays under the cap at year-five scale (D-451's 1,000 runs × 8 km at ~96 pts/km), proven by a test that builds that body and checks the bytes the handler emits.
- [ ] The response is compressed in transit, verified against the deployed app (`Content-Encoding` present, transfer size recorded).
- [ ] A 413, or any non-2xx, from `/api/runs/web` leaves the map usable without the web rather than breaking the page, with a test.

## Notes

Levers, cheapest first: (1) gzip in the handler and set `Content-Encoding: gzip` itself. The cap then sees compressed bytes (~1.1 MB at 1,000 realistic runs), but whether CloudFront passes a handler-set encoding through untouched must be measured, not assumed. The S3 object is already named `web.json.gz`. (2) D-451's delta-encoded integer store (3.06 MB → 1.27 MB gzipped at 96 pts/km), which is a format change. (3) Paginate the web. Not urgent: about 1,800 runs of headroom today.

## Operator validation

None perceptual. Smoke test against the deployed app: `/api/runs/web` answers 200 with
`Content-Encoding` set, and the transfer size is recorded. The year-five body is proven by the test.
