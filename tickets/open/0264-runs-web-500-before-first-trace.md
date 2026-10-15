---
id: 264
slug: runs-web-500-before-first-trace
title: /api/runs/web returns 500 for a user with no trace web yet
type: bug
priority: low
status: open
size: s
capability: 12-post-run-moment
depends_on: [85]
blocked_by: []
source: agent
created: 2026-10-14T16:56:37Z
started: 2026-10-15T12:10:40Z
---

## Description

Found by `0258`'s smoke (2026-10-14). A signed-in user whose `users/<uid>/traces/web.json.gz` does
not exist yet — any account before its first post-`0085` run — gets **500** from `GET /api/runs/web`,
and the map logs `trace web: fetch failed RunFetchError`.

Cause, from the Amplify compute log: `LostSolesAmplifyComputeRole` has no `s3:ListBucket` on the
user-data bucket, so S3 answers a GET for a missing key with **403 AccessDenied**, not 404.
`isMissing` in `lib/fog/server.ts:74` only recognises `NoSuchKey` / `NotFound` / 404, so
`traceWebRuns`' `bytes === undefined → []` branch is never reached and the 403 throws.

The operator's own trace web exists, so this does not bite in real use today. Every other read
through `getObject` for an optional key shares the same shape.

## Acceptance criteria

- [x] `GET /api/runs/web` for a user with no trace web returns 200 `{ runs: [] }`.
- [x] The fix is chosen deliberately and recorded: either grant `s3:ListBucket` scoped by `s3:prefix` to
      `users/*` (IAM posture, `08-security.md`), or
      treat 403 as missing for keys the code knows may be absent. Ask before choosing (D-152).
- [x] A test covers the absent-object path with the error shape S3 actually returns.

## Steps to reproduce

1. Create a throwaway Cognito user (as `tmp/0258/seed.ts` does) and sign in on the deployed site.
2. Load `/` — the map requests `/api/runs/web`.

## Expected vs actual

**Expected:** 200 with an empty `runs` array; no console error.

**Actual:** 500. CloudWatch `/aws/amplify/d14fhvl4rp79nn`: `AccessDenied … is not authorized to
perform: s3:ListBucket on resource: …lostsolesuserdatabucket…`.

## Notes

Filed rather than fixed in `0258` (D-152: never widen a ticket).

## Operator validation

None by eye. Agent: repeat the reproduction against the deployed site and assert 200 + empty runs.

**Result (agent smoke, 2026-10-15, deployed site, headless Chromium):** a throwaway Cognito user
(`smoke-0264-…`, `tmp/0264/seed.ts`) with no trace web signed in to `https://soles.devaultsecurity.com`.
The map's own `/api/runs/web` request returned **200**; a direct fetch returned
**200 `{"runs":[]}`**; no `trace web` console error. 5/5 checks (`tmp/0264/drive.mjs`). `0258` ran
the same flow on 2026-10-14 and got 500. Live IAM checked too: `LostSolesAmplifyComputeRole` now
carries `ListDeliveryLayerSoAbsentReadsAs404` (`s3:ListBucket` on the user-data bucket,
`StringLike s3:prefix users/*`). The user and its data were then deleted (`tmp/0264/cleanup.ts`;
it had written no rows or objects). Amplify build 391 and CI (gate, tickets, secret-scan) are green.

## Resolution

**Fix: grant `s3:ListBucket` scoped to `users/*`, not treat 403 as missing.** The operator chose
it on 2026-10-15; recorded as **D-306**, which supersedes D-228's "no bucket-level `List`" clause.
That clause rested on D-219's premise that bucket-level grants cannot be held to a prefix. The
premise is wrong: `s3:prefix` does it, and `0192`/`0243` already use it. Treating 403 as missing
was rejected because a lost grant would then show up as an empty map with no error.

- `amplify/backend.ts`: new `computeRole` statement `ListDeliveryLayerSoAbsentReadsAs404`, right
  after `ReadExploredDeliveryLayerForTheBrowser`. No route or `isMissing` change: once the role can
  list the prefix, S3 returns `NoSuchKey`/404, which `getObject` already treats as missing.
- `amplify/fog-delivery-read-grant.test.ts`: the test "no bucket-level listing" now asserts exactly
  one `s3:List*` statement, which is `s3:ListBucket` alone with `s3:prefix` `["users/*"]`. The
  `s3:GetBucket*` ban is kept as its own test.
- `lib/fog/server.test.ts`: `getObject` against the SDK's real error shapes. `NoSuchKey`/404 and
  `NotFound`/404 resolve to `undefined`; `AccessDenied`/403 **throws**, so the D-306 posture is held.
- `docs/decisions/DECISIONS.md`: D-306.

**What went wrong.** The first push (`755d0ba`) failed Amplify build 390. I had run
`prettier --write` on `backend.ts` and both test files, and prettier reformatted every line
(semicolons, rewrapping; this repo does not prettier-format them). The rewrap split
`xpLedgerTable.grant(setActivityKindLambda, …, "dynamodb:DeleteItem")` across lines. The
`DeleteItem` line lost its table name, so `check-fog-hot-path.mjs` read it as a T6 delete (I-7).
The backend phase had already deployed, so the IAM grant was live, but the frontend build failed.
`29c4bec` restored all three files from `755d0ba^` and reapplied only the 0264 edits. I didn't
catch it locally because I ran the test suites but not the `amplify.yml` guard scripts before the
first push. Every guard passed on a clean copy before the second push.

