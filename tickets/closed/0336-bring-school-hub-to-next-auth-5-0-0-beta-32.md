---
id: 336
slug: bring-school-hub-to-next-auth-5-0-0-beta-32
title: Bring school-hub to next-auth 5.0.0-beta.32
type: chore
priority: high
status: closed
size: s
capability: 19-authjs-migration
depends_on: [330]
blocked_by: []
source: agent
created: 2026-11-02T19:12:18Z
closed: 2026-11-03T02:05:48Z
---


## Description

Capability `19-authjs-migration`. Decision **D-474** (Lost Soles pins next-auth `5.0.0-beta.32`).
**D-471** puts every session `school-hub` mints inside Lost Soles' trust boundary: both apps share
`AUTH_SECRET` and a `.devaultsecurity.com` cookie. D-470 re-affirms D-123.

`school-hub` runs `next-auth 5.0.0-beta.25`. That version carries critical advisories, two of them
on exactly what Lost Soles relies on: GHSA-8fpg-xm3f-6cx3 (existence-based auth checks can fail
open) and GHSA-7rqj-j65f-68wh (an email-normaliser homoglyph `@` bypass, while email is Lost Soles'
identity key). Also GHSA-x445-f3h2-j279, GHSA-xmf8-cvqr-rfgj and GHSA-5jpx-9hw9-2fx4. `0330` found
these when Lost Soles' deploy audit gate refused beta.25.

**This work happens in the `school-hub` repository**, not this one. This ticket tracks it because
Lost Soles' cutover (`0332`) should not make Google the only way in while a sibling app that can mint
its sessions is on a fail-open version.

## Acceptance criteria

- [x] `school-hub`'s `package.json` pins `next-auth` to exactly `5.0.0-beta.32`, and its
      `npm audit --omit=dev` reports no high or critical advisory for `next-auth` or `@auth/core`.
- [x] `school-hub` is deployed on beta.32: its Amplify app `d1at27fw1o7tr4` `main` build succeeded
      after the upgrade commit.
- [x] `school-hub`'s `lib/auth/config.ts` is unchanged, or, if the upgrade forced a change, Lost
      Soles' copy and its sha256 pin (`lib/auth/config.test.ts`) are updated in the same session,
      and the header names the new source commit.
- [x] (operator) Signing in to `school-hub` still works on the desktop browser after the upgrade.
      — verified 2026-11-02: operator signed in to school-hub on the desktop browser on beta.32; works.

## Notes

The work is in another repo, so the operator decides who does it. A session opened in
`/home/vivicat/school-hub` can do it.

`0330` confirmed that sessions minted by `@auth/core`'s `encode` decrypt in Lost Soles on beta.32.
The JWE format is shared through `AUTH_SECRET` and the cookie name. So the two apps interoperate
across the version gap meanwhile, and the gap is a security exposure, not a compatibility break.

## Operator validation

Agent: the `npm audit` output and the Amplify job status, recorded here. Operator: one sign-in to
`school-hub`.

D-123 trigger checked? **A** (the trust boundary of Lost Soles' identity) — D-470 re-affirms D-123.
No account is added.

**Operator, 2026-11-02, desktop browser:** signed in to `school-hub` after the beta.32 deploy — works.

**Agent smoke test, 2026-11-02, re-run from this session against `school-hub`'s remote and AWS:**
- `git branch -r --contains 6ef6880` → `origin/main`. `package.json:40` → `"next-auth": "5.0.0-beta.32"`.
  `package-lock.json` → `node_modules/@auth/core` 0.41.3.
- `npm audit --omit=dev` (school-hub session's output): no `next-auth` or `@auth/core` entry. Summary
  `8 vulnerabilities (1 low, 3 moderate, 3 high, 1 critical)`, all in other packages and out of scope.
- `aws amplify get-job --app-id d1at27fw1o7tr4 --branch-name main --job-id 27` → `SUCCEED`,
  commit `6ef6880235439b475a1f332f193d61501c41f0db`, ended 2026-11-02T16:22:49-05:00.
- `git diff 099f1ad 6ef6880 -- lib/auth/config.ts` → empty; sha256 `bfa68105…c9db`, unchanged.

## Resolution

Done in the `school-hub` repository, in a separate session opened there at the operator's choice, so
that the work is recorded in that project. This session wrote the prompt and verified the result.

- `school-hub` commit `6ef6880` (`fix(deps): upgrade next-auth 5.0.0-beta.25 -> 5.0.0-beta.32`):
  pins `next-auth` exactly. `@auth/core` was never a direct dependency, so `package.json` needed no
  other change; the lockfile resolves `@auth/core` 0.41.3.
- `lib/auth/config.ts` is unchanged, so Lost Soles' verbatim copy and its sha256 pin are still
  correct. No Lost Soles code changed in this ticket.
- `school-hub` has no test framework (`check-fixtures.ts` stands in). Its typecheck, lint and build
  passed.
- Out of scope, recorded honestly: `school-hub`'s audit still lists 8 advisories (one critical) in
  packages other than next-auth and @auth/core. They are not in Lost Soles' trust boundary, which
  D-471 draws at the session cookie, so this ticket leaves them alone.
- Stale reference found while checking: Lost Soles' `lib/auth/config.ts` header still says
  "D-NEW-a, amending D-471" where it should say D-474. The fix is a comment-only edit that would cost
  a build on its own, so it rides with `0332`, which edits the auth modules anyway.
