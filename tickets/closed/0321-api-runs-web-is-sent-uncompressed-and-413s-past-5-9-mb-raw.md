---
id: 321
slug: api-runs-web-is-sent-uncompressed-and-413s-past-5-9-mb-raw
title: /api/runs/web is sent uncompressed and 413s past ~5.9 MB raw
type: chore
priority: low
status: closed
size: m
capability: 12-post-run-moment
depends_on: []
blocked_by: []
source: agent
created: 2026-10-27T01:39:35Z
started: 2026-11-09T16:13:05Z
closed: 2026-11-09T16:32:22Z
---

## Description

Measured by `0320` (D-460). Amplify compute refuses a response whose raw body passes about 5.94 MB: 5,936,087 bytes returned 200, about 6.03 MB returned 413 with an empty body, whatever `Accept-Encoding` the client sent. Route-handler JSON is also never compressed in transit (no `Content-Encoding` even when gzip or br is asked for), so D-451's "1.13 MB transferred, gzipped in transit" does not hold in production. `/api/runs/web` is sent and capped raw.

Today 113 runs are 316 KB raw (~2.8 KB a run), so the cap arrives near **2,100 runs** at current density. At D-451's realistic density (~30 pts/km, 8 km runs) it arrives near **1,000 runs**, and near ~300 at the noisy ~96 pts/km. Past it, the trace web stops loading: a 413, not a slow load.

## Acceptance criteria

- [x] `/api/runs/web`'s compute output stays under the cap at year-five scale (D-451's 1,000 runs × 8 km at ~96 pts/km), proven by a test that builds that body and checks the bytes the handler emits.
- [x] The response is compressed in transit, verified against the deployed app (`Content-Encoding` present, transfer size recorded).
- [x] A 413, or any non-2xx, from `/api/runs/web` leaves the map usable without the web rather than breaking the page, with a test.

## Notes

Levers, cheapest first: (1) gzip in the handler and set `Content-Encoding: gzip` itself. The cap then sees compressed bytes (~1.1 MB at 1,000 realistic runs), but whether CloudFront passes a handler-set encoding through untouched must be measured, not assumed. The S3 object is already named `web.json.gz`. (2) D-451's delta-encoded integer store (3.06 MB → 1.27 MB gzipped at 96 pts/km), which is a format change. (3) Paginate the web. Not urgent: about 1,800 runs of headroom today.

## Resolution

**Lever 1, as the Notes proposed: the handler gzips its own body (D-488).** CloudFront passing a
handler-set encoding through untouched was the open risk, and it was measured live, not assumed. It
does pass through.

Files:
- `lib/runs/web-body.ts` (new): `encodeWebBody(runs)` gzips `{ runs }`, plus
  `AMPLIFY_RESPONSE_CAP_BYTES` (D-460's 5,936,087). It lives outside the route because Next
  refuses non-standard exports from a route file.
- `app/api/runs/web/route.ts`: it returns the gzipped bytes with `Content-Encoding: gzip`,
  `Content-Type: application/json` and `Vary: Accept-Encoding`. `withNoStore` still sets
  `Cache-Control`. Not negotiated: a client asking for `identity` still gets gzip (D-488 says why).
- `lib/trace-web/load.ts` (new): `loadDrawnWeb`, which is `useTraceWeb`'s fetch-and-build lifted
  out of the hook so it can be driven in vitest's `node` environment. It resolves `null` on any
  failure and never rejects. `components/map/use-trace-web.ts` now calls it; its behaviour is
  unchanged.
- `docs/decisions/DECISIONS.md`: D-488, and a back-pointer on D-460. `docs/INDEX.md` rebuilt.

Tests:
- `lib/runs/web-body.test.ts`: year five is 1,000 runs × 8 km × 96 pts/km. The geometry is a seeded
  random walk near Point Nemo, `round5` like the store. It asserts the raw body is past the cap
  (so the test proves the fix, not an easy case), that the emitted bytes are under 75% of the cap,
  and that they round-trip exactly. A one-off measurement gave 17.6 MB raw → 2.65 MB gzipped at
  96 pts/km, and 5.55 MB → 1.09 MB at 30 pts/km. The latter agrees with D-451's local 1.13 MB.
- `app/api/runs/web/route.test.ts`: the 200 body is gunzipped before comparing. A new case checks
  the three headers and the gzip magic bytes.
- `lib/trace-web/load.test.ts`: 413/500/502/503 each resolve to no web with one log line. A failed
  fetch is not cached, so the next ask draws. A 413 reaches `webRuns` (the run index and the
  region list) as a typed `RunFetchError`.

**Criterion 3 needed a test, not a fix.** Every consumer already caught a rejected fetch:
`useTraceWeb` logs and draws nothing, `map-controls` and `region-jump` swallow, and beat 1 sets
`"none"`. The extraction is what made that testable.

What went wrong:
- The first encoder was exported from `route.ts`, and the "exports no mutating verb" test caught
  it. I moved it to `lib/runs/`.
- Running the `amplify.yml` guards in a plain copy failed three checks for environmental reasons:
  no `.git`, a symlinked `node_modules`, and no build for the prerender check. All of them passed
  against a git clone or the real tree, except the prerender check, which needs `npm run build`
  and is left to CI (this change adds no page). That loop also ran `write-authjs-env.mjs` bare,
  which memory warns against. It wrote `.env.production` only inside the scratchpad copy, which
  was deleted at once. The repo was never touched.
- The first smoke run got 404s because SSM's `AUTH_SESSION_COOKIE` is the bare name
  `devault.session-token`, and over HTTPS Auth.js reads the `__Secure-` prefixed cookie (as
  `0335` used).

Side observation, not acted on: the middleware's signed-out 404 JSON also arrived
`content-encoding: gzip` (41 bytes against 21 identity), unlike D-460's probe. Small middleware
bodies may be compressed somewhere upstream. It changes nothing here.

## Operator validation

None perceptual. **Smoke test against production, by the agent, 2026-11-09**, Amplify job 461
(`5e3ff6b`, SUCCEED). Method: `0335`'s, approved by the operator for this ticket. A scratchpad
script read `AUTH_SECRET`, `AUTH_SESSION_COOKIE` and `AUTH_ALLOWED_EMAILS` from SSM into memory
only, minted a 10-minute Auth.js JWE per allowlisted email, and made a raw `https.get` of
`/api/runs/web` so the bytes counted are the bytes on the wire. It printed headers and sizes only;
the body (real routes) was gunzipped to count bytes and runs, then discarded. The script was deleted.

```
cookie name: __Secure-devault.session-token; allowlist size: 2
allowlisted #0 AE="gzip, deflate, br" -> 200 content-encoding=gzip content-type=application/json vary=rsc,Accept-Encoding cache-control=no-store, private wire-bytes=73202 decoded-bytes=317034 runs=113 x-cache=Miss from cloudfront
allowlisted #0 AE="identity"          -> 200 content-encoding=gzip content-type=application/json vary=rsc,Accept-Encoding cache-control=no-store, private wire-bytes=73202 decoded-bytes=317034 runs=113 x-cache=Miss from cloudfront
allowlisted #1 (both AE)              -> identical to #0
```

What it proves: `Content-Encoding: gzip` is present. Transfer is **73,202 bytes for 317,034 raw**
(113 runs, 4.3×). The wire bytes are the handler's own gzip, passed through once: they gunzip
directly to valid JSON, with no double encoding. `no-store, private` holds, and CloudFront did not
cache it. The year-five body is proven by `lib/runs/web-body.test.ts`.
