---
id: 143
slug: 08-section-5-3-security-headers-are-in-no-ticket-hsts-nosnif
title: 08 section 5.3 security headers are in no ticket — HSTS, nosniff, frame-ancestors, CSP
type: feature
priority: med
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-09-02T01:55:54Z
started: 2026-10-23T02:20:14Z
---

## Description

`08-security-privacy.md` §5.3's **Headers** row specifies, for every authed response:

> `Cache-Control: private, no-store` […] plus HSTS, `X-Content-Type-Options: nosniff`,
> `frame-ancestors 'none'`, and a CSP whose `connect-src` allows only the AppSync endpoint, the API
> origin, and the R2 tiles host

`Cache-Control: private, no-store` is covered — it is `0114`'s criterion C-3. **The other four are
in no ticket in the backlog.** `next.config.ts` sets no `headers()` and `middleware.ts` sets none,
so nothing at `soles.devaultsecurity.com` sends any of them today.

**Why this is worth its own ticket rather than a note.** §5.3 accepts a real risk on the strength of
one of these controls. Its token-storage row keeps the JWTs in `localStorage` and defends the choice
like this:

> an XSS in this app can steal a session — but an XSS in this app can also just *read the map*,
> which is the asset […] **The mitigation for XSS is a strict CSP and no
> `dangerouslySetInnerHTML`, not token gymnastics.**

The accepted risk and the compensating control were decided together. Shipping the acceptance and
not the control leaves the reasoning half-applied — and the half that is missing is the half that
does the work. This is not a hole anyone drilled; it is one nobody filled, which is exactly the kind
the close audit exists to find.

Capability `18` is the right home: §5.3's headers are hardening, and `09-roadmap.md` §2.3 does not
list them among what is deliberately missing at the first-usable milestone, so their absence is an
oversight rather than a deferral. Sequence with `0115` (secrets/dependency audit) and `0114`
(D-123 standing conditions), which already own the neighbouring rows of the same section.

## Acceptance criteria

- [x] `Strict-Transport-Security`, `X-Content-Type-Options: nosniff` and a
      `frame-ancestors 'none'` directive are sent on every response from the app.
      *Amended after deploy (D-444): every response Next serves, i.e. every document, redirect and
      route handler. Amplify Hosting serves `_next/static/*` and `public/` files (`/maplibre/`,
      `/basemap-assets/`) from its CDN without `next.config` `headers()`, which `next start` could not
      show. CSP and `frame-ancestors` act only on documents, and HSTS is recorded from any response,
      so nothing those files lack is a control.*
- [x] A CSP is sent whose `connect-src` allows only the AppSync endpoint, the app's own origin, and
      the R2 tiles host — no wildcard, and the tiles host named rather than inherited.
      *Amended: plus `cognito-idp` and `cognito-identity` for the region. The browser calls both
      (sign-in, refresh and sign-out; the identity-pool credential exchange), and the list predated
      that knowledge. The "R2 tiles host" is the CloudFront distribution (D-226), named from
      `amplify_outputs.json`.*
- [x] The CSP is verified not to break the map: MapLibre, the pmtiles range requests and the
      WebGL worker all still load. A CSP that ships and is then loosened in a panic is worse than
      one designed against the real asset list.
      *Partly verified, so left unticked: headless Chromium against the local production build,
      on the signed-out `/` under the shipped CSP. There the worker loads, glyphs load, and the
      tiles, AppSync and Cognito hosts raise no CSP violation. Third-party fetch, image and blob
      worker are blocked (the controls). The signed-in map could not be loaded locally (no
      session against the production pool), so the post-deploy check completes this criterion.*
      — verified 2026-10-25: operator, desktop browser, signed in: the map's tiles and fog render under the shipped CSP, with no violation in the Console.
- [x] `dangerouslySetInnerHTML` appears nowhere in the app, asserted by a check rather than by
      reading — §5.3 names it as the other half of the XSS mitigation.
- [x] A test asserts the headers are present on a representative authed route, so they cannot be
      dropped by a later `next.config.ts` edit without something going red.
- [x] Where the headers are set is stated in the Resolution — `next.config.ts` `headers()` and
      `middleware.ts` are both plausible and they behave differently for static assets. Pick
      deliberately.

## Notes

Found by the capability `02` close audit (2026-09-02), AUDIT.md §2, resolved as `code-was-wrong`.
Recorded as divergence 4 of 4 in that audit and in **D-245**.

Filed against capability `18` rather than `02` because it is hardening, not deploy-and-auth — but
found in `02` because `0014` cited §5.3 and `0016` built the responses that should carry the
headers. Note `0019` (capture endpoint hardening) covers CORS for `/api/tickets/capture`
specifically; keep the two from overlapping.

## Operator validation

**Operator, 2026-10-25, desktop browser, signed in at `https://soles.devaultsecurity.com`:**
checks good. The document response carries HSTS, `nosniff` and the CSP with
`frame-ancestors 'none'`. The map's tiles and fog render, with no CSP violation in the Console.

**Smoke tests (orchestrator, 2026-10-22):** curl against the deployed app shows the headers on
every response Next serves, but not on CDN-served static files. That is recorded as D-444.
`lib/security-headers.test.ts` and the `react/no-danger` lint rule guard the policy in CI.

## Resolution

**Where the headers are set: `next.config.ts` `headers()`, source `/:path*`, built by
`lib/security-headers.ts`.** `middleware.ts` was the other option, and I chose against it for two
reasons:
- Its matcher deliberately skips `_next/static`, `/maplibre/` and `/basemap-assets/`, because a
  worker or a glyph PBF must never take the auth redirect. HSTS and `nosniff` belong on those
  responses too.
- With no nonce (D-441), nothing in the headers varies per request, so middleware has no reason
  to own them.

Checked with `curl` against `next start`:
- every path sends exactly one copy of each header;
- that holds for the middleware's own 307 redirects and 404 JSON, so config and middleware do not
  double up;
- static chunks and the MapLibre worker carry the headers too.

The one response without them is Next's own trailing-slash 308, which has no body.

**The policy.**
`default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self'; connect-src 'self' <AppSync> <tiles distribution>
https://cognito-idp.<region>.amazonaws.com https://cognito-identity.<region>.amazonaws.com;
worker-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self';
frame-ancestors 'none'`. `next dev` alone adds `'unsafe-eval'`.

- HSTS is `max-age=63072000; includeSubDomains`, without `preload`: the preload list commits the
  whole registrable domain, and that is not this app's to commit.
- The AppSync origin (`data.url`), the tiles origin (`custom.basemapTilesUrl`) and the region are
  read from `amplify_outputs.json` at build time, the way the home coordinate already is.
- A missing value fails the build loudly rather than leaving a host out. In CI the build reads the
  example file, so CI's CSP names example hosts. A deploy builds after `pipeline-deploy` has written
  the real file.
- No client code subscribes to AppSync, so the realtime websocket host is deliberately absent.
- The browser's network calls were found in the code, not in §5.3's prose:
  - `generateClient` in `lib/{skills,log,runs,run-kind}/transport.ts`;
  - the Authenticator in `components/auth-gate.tsx`;
  - `signOut` in `app/settings/settings-controls.tsx`;
  - the pmtiles protocol and `lib/place-names.ts`;
  - `/basemap-assets/` (D-437);
  - the worker at `/maplibre/maplibre-gl-worker.js`.

**Decisions (proposed; the orchestrator allocates the ids).**
- **D-441 (operator, via the orchestrator): no nonce.**
  - `script-src 'self' 'unsafe-inline'`. A nonce reaches only pages rendered per request, and
    D-282 keeps `/log` and `/skills` static so `/log` renders offline. The route table is unchanged
    by this ticket, and `check-prerender-no-cell-data` is untouched.
  - §5.3's "strict CSP" is amended to say what this CSP actually does. It limits third-party script
    and exfiltration. It does not stop injected inline script.
- **D-442: `style-src 'unsafe-inline'`.** Server-rendered `style="…"` attributes can carry neither
  a nonce nor a hash. Style injection is not script execution, and the `url()` fetches it could
  cause are bounded by `img-src`, `font-src` and `connect-src` anyway.

**`dangerouslySetInnerHTML`.**
- `react/no-danger` is now an ESLint `error` in every file, tests included (`eslint.config.mjs`). A
  probe file using the prop fails lint with that rule.
- Its only uses, both in `app/run/[activityId]/run-moment.test.tsx`, now render the `TallyView`
  element directly instead of injecting its HTML.
- `lib/security-headers.test.ts` also asserts the rule is still in the config, so deleting it
  quietly fails the suite as well.

**The header test (criterion 5).** `lib/security-headers.test.ts` calls the real `next.config.ts`
`headers()` and matches each source with Next's own compiled `path-to-regexp`. It asserts HSTS,
`nosniff`, `frame-ancestors 'none'` and a named `connect-src` on:
- `/settings`, the representative authed route;
- `/`, `/run/…` and `/api/fog`;
- the three middleware-exempt static paths.

It also asserts the exact `connect-src` list with no `*`, no eval outside dev, and a loud failure
when a host is missing. `types/next-path-to-regexp.d.ts` declares the one untyped function used.

**Doc finding, amended.** In `docs/08-security-privacy.md` §5.3:
- the Token storage row: "strict CSP" becomes the honest description (D-441);
- the Headers row: `*.cloudfront.net` becomes "named, never wildcarded";
- the same row now lists the two Cognito endpoints, which it lacked;
- the same row now says where the headers are set, and points at D-442.

Both rows were edited in place, so no line numbers moved.

**Files.**
- `lib/security-headers.ts` (new)
- `lib/security-headers.test.ts` (new)
- `types/next-path-to-regexp.d.ts` (new)
- `next.config.ts`
- `eslint.config.mjs`
- `app/run/[activityId]/run-moment.test.tsx`
- `docs/08-security-privacy.md`
- `scripts/check-adapter-deletion.mjs`. `next.config.ts` is added to the tree it copies, because
  the new test imports it. Without it the compile failure was reported as an adapter leak, the
  same trap `rules/` hit in 0047.

**Local browser check (agent, snap Chromium headless over CDP, WSL, production build via
`next start`).** On the signed-out `/`:
- The page hydrates (the Authenticator renders) with zero CSP violations.
- Allowed under the page's CSP, with no violation:
  - `new Worker('/maplibre/maplibre-gl-worker.js', {type: 'module'})` stays alive;
  - a `/basemap-assets/` glyph PBF fetches with 200;
  - fetches to the tiles distribution, AppSync, `cognito-idp` and `cognito-identity`. The tiles
    fetch then fails on CORS, because the distribution does not allow a `localhost` origin. That is
    not the CSP.
  - a `blob:` image loads;
  - WebGL2 is available.
- Controls, all blocked with the expected violations: a fetch to `https://example.com`
  (connect-src), an image from it (img-src), and a `blob:` worker (worker-src).
- Not verifiable locally: the signed-in map actually painting tiles and fog. That is the
  post-deploy check below.

**Ticket 0113** (in parallel) owns offline behaviour and the no-third-party-origins check. This
ticket touched neither.

