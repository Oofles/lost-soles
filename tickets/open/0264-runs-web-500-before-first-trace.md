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

- [ ] `GET /api/runs/web` for a user with no trace web returns 200 `{ runs: [] }`.
- [ ] The fix is chosen deliberately and recorded: either grant `s3:ListBucket` scoped by `s3:prefix` to
      `users/*` (IAM posture, `08-security.md`), or
      treat 403 as missing for keys the code knows may be absent. Ask before choosing (D-152).
- [ ] A test covers the absent-object path with the error shape S3 actually returns.

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
