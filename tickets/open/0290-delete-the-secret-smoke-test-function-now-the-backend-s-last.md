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

- [ ] `amplify/functions/secret-smoke-test/` is deleted, and its import and `defineBackend` entry
      are removed from `amplify/backend.ts`, along with the `0017` comment above the entry.
- [ ] Comments that cite it as a live example are updated, for example
      `amplify/functions/process-activity/resource.ts` around line 28.
- [ ] The `STRAVA_WEBHOOK_VERIFY_TOKEN` SSM parameter itself is **not** deleted. The webhook reads
      the shared path (D-357), and `scripts/strava-subscription.mjs rotate-token` writes it.
- [ ] typecheck, lint, the unit suite and the `amplify.yml` build-phase guards pass, and
      `scripts/check-bundle-leak.mjs` still runs and passes. It is the standing control and does
      not depend on this function.

## Notes

`docs/capabilities/02-deploy-and-auth.md` mentions the function historically. Leave that record as
it is.

## Operator validation

None expected. Smoke test after deploy: `aws lambda list-functions --profile devault` shows no
`secretsmoketest` function. A webhook handshake with the real token still returns the exact bytes,
which shows the SSM parameter survived.
