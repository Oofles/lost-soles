---
id: 290
slug: delete-the-secret-smoke-test-function-now-the-backend-s-last
title: Delete the secret-smoke-test function, now the backend's last secret() user
type: chore
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-19T05:14:32Z
started: 2026-10-26T20:04:43Z
---

## Description

`amplify/functions/secret-smoke-test` (ticket `0017`) exists to prove Amplify's `secret()` resolves.
Its own comment says to delete it "when `token-refresh` (ticket 0094) ships". That has happened, but
`0094`'s Resolution left it in place, for two reasons. The premise was wrong, since `token-refresh` reads
SSM through `oauth-credentials.ts` and not through `secret()`. And `0091` was editing the same
`defineBackend` block at the time.

Since `0286` (D-357) the webhook reads its verify token with a hand-signed SSM `GetParameter`, so
**nothing in the backend uses `secret()` any more except this function**. It proves a mechanism no
consumer depends on, and it still costs a deployed Lambda, an IAM role, and an
`ssm:GetParameters` on a secret path. Found at capability `14`'s audit, 2026-10-19.

## Acceptance criteria

- [x] `amplify/functions/secret-smoke-test/` is deleted, and its import and `defineBackend` entry
      are removed from `amplify/backend.ts`, along with the `0017` comment above the entry.
- [x] Comments that cite it as a live example are updated, for example
      `amplify/functions/process-activity/resource.ts` around line 28.
- [x] The `STRAVA_WEBHOOK_VERIFY_TOKEN` SSM parameter itself is **not** deleted. The webhook reads
      the shared path (D-357), and `scripts/strava-subscription.mjs rotate-token` writes it.
- [x] typecheck, lint, the unit suite and the `amplify.yml` build-phase guards pass, and
      `scripts/check-bundle-leak.mjs` still runs and passes. It is the standing control and does
      not depend on this function.

## Notes

`docs/capabilities/02-deploy-and-auth.md` mentions the function historically. Leave that record as
it is.

## Operator validation

None expected. Smoke test after deploy: `aws lambda list-functions --profile devault` shows no
`secretsmoketest` function. A webhook handshake with the real token still returns the exact bytes,
which shows the SSM parameter survived.

## Resolution

Deleted `amplify/functions/secret-smoke-test/` (`handler.ts`, `resource.ts`) and removed its import,
its `defineBackend` entry and the `0017` comment above that entry from `amplify/backend.ts`. On
deploy CloudFormation removes the Lambda, its service role and the role's `ssm:GetParameters` on
the verify-token paths. Nothing else in the backend uses `secret()` now.

Files touched:

- `amplify/functions/secret-smoke-test/handler.ts`: deleted.
- `amplify/functions/secret-smoke-test/resource.ts`: deleted.
- `amplify/backend.ts`: the import and the `defineBackend` entry are gone, along with its comment.
- `amplify/functions/process-activity/resource.ts`: the "NO `secret()` HERE" block cited the smoke
  test as a live `secret()` user. It now says nothing in the backend uses `secret()` since `0290`.
- `scripts/check-secret-storage.mjs`: the `AMPLIFY_RUNTIME_PLACEHOLDER` doc comment named the
  smoke test as the remaining user. The comment now records its removal. The allowance itself and
  its self-test fixture stay, so a future `secret()` is judged correctly (a placeholder value is
  not plaintext) and is not flagged.

Left alone on purpose:

- The `STRAVA_WEBHOOK_VERIFY_TOKEN` SSM parameter. The webhook reads the shared path through its own
  `ssm:GetParameter` grant (D-357), and `rotate-token` writes it.
- The historical mentions in `docs/capabilities/02-deploy-and-auth.md` (per Notes), and also
  `14-webhook-and-automatic-sync.md` §84 and `18-mvp-hardening.md` §58. Those two are audit records
  of what was true when they were written, not live claims.
- Generic `secret()` remarks in `check-bundle-leak.mjs`, `check-boundaries.mjs` and `.env.example`.
  They describe the mechanism and not this function.

No decisions were made. The ticket fully specified the change.

Verification, in the worktree: every `node`/`npm` command in `amplify.yml`'s backend and build
phases exits 0. That covers typecheck, lint, `npm test` (vitest), `npm run build`, and
`check-bundle-leak.mjs --self-test` and `--require-literals`.
`check-secret-storage.mjs --require-literals` needs the Amplify env, so it was run with
`AWS_APP_ID`/`AWS_BRANCH=main` against the current deployed state: 18 stacks, 19 Lambdas, pass.

Pre-deploy dry run of the smoke test, read-only: the Lambda and its role are both still present,
as expected before deploy. The webhook GET handshake with the real token from SSM already returns
the exact bytes.
