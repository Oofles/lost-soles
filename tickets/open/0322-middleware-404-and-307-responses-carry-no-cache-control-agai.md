---
id: 322
slug: middleware-404-and-307-responses-carry-no-cache-control-agai
title: Middleware 404 and 307 responses carry no Cache-Control, against D-429
type: bug
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-28T02:22:22Z
started: 2026-10-28T03:22:38Z
---

## Description

D-429 and `08-security-privacy.md` §5.3 (C-3) say every response carries `Cache-Control: private,
no-store`, including 404s and redirects. `withNoStore` (`lib/http/no-store.ts`) guarantees that for
route handlers, but the middleware answers some requests itself, and those two responses carry no
`Cache-Control` at all:

- `middleware.ts:77`: `NextResponse.json({ error: "not found" }, { status: 404 })` for an
  unauthenticated `/api/*` request;
- `middleware.ts:89`: `NextResponse.redirect(url)`, the 307 to `/?next=…` for an unauthenticated
  page request.

Neither carries data, so the exposure is nil. The gap is that D-429's "every response" holds only
for route handlers, and the check `check-route-cache-control.mjs` can't see middleware. Found by the
capability 18 drift audit (§2, `08` §5.3), 2026-10-27.

## Acceptance criteria

- [x] Both middleware responses set `Cache-Control: no-store, private` (reuse `NO_STORE` from
      `lib/http/no-store.ts`; no second spelling of the string).
- [x] A middleware test asserts the header on the `/api/*` 404 and on the page 307.
- [ ] Smoke test after deploy: `curl -sI https://soles.devaultsecurity.com/api/fog` and
      `curl -sI https://soles.devaultsecurity.com/skills` both show `cache-control: no-store, private`.

## Steps to reproduce

1. `curl -sI https://soles.devaultsecurity.com/api/fog` with no cookie.
2. Read the response headers.

## Expected vs actual

**Expected:** `HTTP/2 404` with `cache-control: no-store, private` (D-429).

**Actual:** `HTTP/2 404`, no `cache-control` header (`x-cache: Error from cloudfront`), 2026-10-27.

## Notes

The other responses in this file (`return response`, i.e. `NextResponse.next()`) fall through to
the route or page, which set their own headers. Only the two responses the middleware builds itself
are in scope.

## Operator validation

None owed. Header behaviour, so the smoke test in the criteria is the check.

D-123 trigger checked? none. It tightens a header on responses that already serve no data.

## Resolution

**Files touched**

- `middleware.ts`: imports `NO_STORE` from `lib/http/no-store.ts`. The signed-out `/api/*` 404
  passes `headers: { "Cache-Control": NO_STORE }` in its `NextResponse.json` init; the signed-out
  page 307 is built with `NextResponse.redirect(url)` and then has `Cache-Control` set to
  `NO_STORE` before it is returned. A comment says why these two are set by hand: route handlers get
  the header from `withNoStore`, and `check-route-cache-control.mjs` cannot see the middleware.
- `middleware.test.ts`: new block, "Cache-Control on the middleware's own responses (0322)". It
  asserts `cache-control === NO_STORE` on the signed-out 404 for `/api/fog`,
  `/api/tickets/capture` and `/api`, on the 404 for a bearer token that fails verification, and on
  the 307 for `/skills`. It compares against the imported constant, so the string has one spelling.

**Decisions:** none new. This applies D-429 / `08` §5.3 C-3 ("every response, 404s and redirects
included") to the two responses the middleware builds itself. The `return response` paths
(`NextResponse.next()`) are unchanged: they fall through to a route or page, which sets its own
header, as the ticket's Notes say.

**Why not widen the build check:** `check-route-cache-control.mjs` scans route handlers for the
`withNoStore` wrapper. The middleware has exactly two self-built responses and the unit test now
guards both, so teaching the script to parse `middleware.ts` would add machinery for two lines. If
the middleware gains more self-built responses, revisit that.

**Verification (worktree):** every guard in `amplify.yml`'s build phase exits 0
(`check-secret-storage --require-literals` run with `AWS_APP_ID`/`AWS_BRANCH` exported, read-only),
plus `npm run typecheck`, `npm run lint`, `npx vitest run` (276 files, 4542 passed, 1 skipped)
and `npm run build`. The smoke-test criterion stays unticked until after deploy.
