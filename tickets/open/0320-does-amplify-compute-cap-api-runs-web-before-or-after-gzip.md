---
id: 320
slug: does-amplify-compute-cap-api-runs-web-before-or-after-gzip
title: Does Amplify compute cap /api/runs/web before or after gzip?
type: chore
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-26T19:31:39Z
started: 2026-10-26T22:03:10Z
---

## Description

Filed by `0259` (D-451). Amplify's SSR compute caps response size. At realistic density (~30 pts/km) the raw `/api/runs/web` body passes ~6 MB around 1,000 runs, but gzipped it is ~1.1 MB. If the cap applies to the uncompressed body, the trace web stops loading somewhere in the next few years. If it applies to the compressed body, nothing needs doing. Settling it needs a write (an oversized test response on a throwaway route or branch), so it could not be settled read-only.

## Acceptance criteria

- [x] Whether Amplify compute's response-size limit applies to the raw or the gzipped body is
      established by measurement against throwaway resources, not from documentation alone.
- [x] If it applies to the raw body, the run count at which `/api/runs/web` would hit the cap at
      ~30 pts/km is recorded, and a follow-up ticket is filed (D-451 names delta encoding as the
      known lever). If it applies to the gzipped body, D-451's known-limits bullet says so.

## Notes

Not urgent. 113 real runs are 316 KB raw today. Related: `0259`, D-299, D-451.

## Operator validation

**None perceptual. Measured by the orchestrator against the deployed app, 2026-10-26, Amplify job 436
(`35adb32`).** A token-gated `GET /probe/size?mb=N` returned synthetic JSON shaped like the trace
web, with no coordinates and no user data.
- No header or a wrong header: 404, the same as a missing route.
- 1, 4, 5 and 6 MB targets (976,078 to 5,841,646 bytes): 200. 5.9 MB (5,745,716) and 6.1 MB
  (5,936,087) also returned 200.
- 6.2 MB (about 6.03 MB of body) and every size up to 16 MB: **413**, empty body.
- Every case was run with `Accept-Encoding: identity`, `gzip` and `br`. The results were identical,
  and no response carried `Content-Encoding`. `/` with gzip requested did come back
  `content-encoding: gzip`.
- After `460b265` deployed, `/probe/size` no longer exists (result below).

**Removal confirmed:** Amplify job 437 (`460b265`) succeeded. `GET /probe/size?mb=1` with the token
now returns 307 to `/?next=/probe/size`, the middleware's normal signed-out redirect, so neither the
route nor its matcher exemption is live. GitHub `gate` run 40433823456 passed.

## Resolution

**The cap applies to the raw body (D-460), so the raw branch of the criteria applies.** The run
count is recorded, and the follow-up `0321` is filed.

How it was measured, and what changed on the way:
- **Plan A, a throwaway Amplify app, failed.** `CreateApp` returned `LimitExceededException` three
  times (one CLI call and its retries), although the Apps quota is 25 and the account has 10. Every
  console-created app had succeeded, so the refusal seems specific to repo-less apps created through
  the API. The operator checked the reasoning and asked for another route.
- **Plan B, used: a temporary probe on the real app.** `app/probe/size/route.ts` was token-gated by
  a SHA-256 digest; the token never entered the repo. `/probe/size` was exempted in
  `middleware.ts`'s matcher, because the probe could not hold the operator's session. It went out
  with `0318` in one build (job 436) and was reverted in the next commit (`460b265`). It was live
  for roughly 25 minutes.
- **A local check first:** Next 15.5.28's standalone server does not gzip a route handler's JSON.
  The deployed measurement agrees.

**Run count at the cap (~5.94 MB raw):**
- About **2,100 runs** at today's measured density (113 runs = 316 KB, ~2.8 KB a run).
- About **1,000 runs** at D-451's realistic ~30 pts/km × 8 km.
- About **300 runs** at the noisy ~96 pts/km.

D-451's own text was not edited: it is a settled decision. D-460 corrects its "gzipped in transit"
measurement explicitly.

**A finding, not fixed here and proposed to the operator rather than filed:** the middleware matcher skips any path ending in
`.png`, `.jpg`, `.svg` and similar, so a future route handler with such a path would skip the
session gate. Today no route does, and every handler also checks `currentUserId()` itself. Whether
to ticket it was put to the operator in the wave summary.
