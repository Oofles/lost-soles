---
id: 286
slug: webhook-cold-start-take-the-verify-token-ssm-read-off-the-po
title: Webhook cold start: take the verify-token SSM read off the POST path
type: chore
priority: med
status: open
size: s
capability: 14-webhook-and-automatic-sync
depends_on: []
blocked_by: []
source: agent
created: 2026-10-18T02:50:37Z
started: 2026-10-18T12:44:03Z
---

## Description

`0092` wired `STRAVA_WEBHOOK_VERIFY_TOKEN` through Amplify's `secret()` (D-347), which resolves
it with `ssm:GetParameters` in the Lambda's init on **every** cold start. It makes two round
trips: the branch path misses, then the shared path hits. Every event POST pays this, although
only the handshake GET reads the token, and the GET is used once, at subscription creation.

Measured on the deployed stack on 2026-10-18 (Amplify job 411, see `0092`'s Operator validation):

- Init rose from about 300 ms to 673–683 ms.
- A cold known-owner POST (a receipt duplicate) took 1.27 s client-side. 0091 measured 0.71–0.90 s
  for the same call after D-346's warm-up.
- A cold `create` also pays the first SQS send, so it is the tightest call against Strava's 2 s
  deadline. It is not measured.

D-347 names the fallback: read the token lazily, on GET only, through one explicit SSM grant,
and drop the `secret()` environment entry.

## Acceptance criteria

- [ ] A POST cold start makes no SSM call. Asserted by a test on the handler, and on the deployed
      stack by an Init Duration back near 0091's ~300 ms.
- [ ] The GET handshake still reads the token from the SecureString and still fails closed if the
      token is missing. `0092`'s handshake tests pass unchanged.
- [ ] The webhook's IAM stays held to exactly the token's path(s). The pinned-grant test in
      `amplify/ingest-webhook-stack.test.ts` is updated on purpose, with the reason.
- [ ] A cold `create` POST is measured client-side on the deployed stack and recorded.

## Notes

Not urgent. A cold POST at 1.27 s is still inside 2 s, and a missed event is recovered by the
sweep (`0095`), hours late. But the margin is what D-346 was bought for, and `0092` spent most of
it on a token the POST path never reads.

Keep the token out of logs and out of the bundle, as `0092` did (`check-bundle-leak
--require-literals`).

## Operator validation

None needed: Init Duration and the client-side timing are smoke tests, run with `AWS_PROFILE=devault`
and `curl` against the deployed URL.
