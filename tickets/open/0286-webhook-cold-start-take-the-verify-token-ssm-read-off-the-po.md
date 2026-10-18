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
      *Code half done — `webhook-secret.test.ts` drives a create, a dropped event and a deauth
      through the real handler and constructs no SSM reader, reads nothing and calls no `fetch`.
      Left unticked: the Init Duration half is post-deploy (orchestrator smoke test).*
- [x] The GET handshake still reads the token from the SecureString and still fails closed if the
      token is missing. `0092`'s handshake tests pass unchanged.
- [x] The webhook's IAM stays held to exactly the token's path(s). The pinned-grant test in
      `amplify/ingest-webhook-stack.test.ts` is updated on purpose, with the reason.
- [ ] A cold `create` POST is measured client-side on the deployed stack and recorded.
      *Post-deploy; left for the orchestrator's smoke test.*

## Notes

Not urgent. A cold POST at 1.27 s is still inside 2 s, and a missed event is recovered by the
sweep (`0095`), hours late. But the margin is what D-346 was bought for, and `0092` spent most of
it on a token the POST path never reads.

Keep the token out of logs and out of the bundle, as `0092` did (`check-bundle-leak
--require-literals`).

## Operator validation

None needed: Init Duration and the client-side timing are smoke tests, run with `AWS_PROFILE=devault`
and `curl` against the deployed URL.

## Resolution

The verify token is no longer an Amplify `secret()`. The webhook reads it from SSM **on a GET only**,
through one explicit grant, with a hand-signed `GetParameter` request. An event POST's cold start
touches no SSM. D-347 names this fallback; the request mechanism is D-357 (operator, Q1 = A).

**Files**
- `amplify/functions/ingest-webhook/resource.ts`: the `secret()` environment entry is removed, so
  Amplify's init banner has an empty `AMPLIFY_SSM_ENV_CONFIG` and returns before any SSM import.
- `amplify/backend.ts`: statement `ReadWebhookVerifyToken`, `ssm:GetParameter` on exactly
  `/amplify/shared/d14fhvl4rp79nn/STRAVA_WEBHOOK_VERIFY_TOKEN`. The same constant is set as env
  `WEBHOOK_SECRET_PARAMETER`, so the grant and the name read cannot drift apart. The parameter is a
  SecureString under `alias/aws/ssm` (checked live), so no `kms:` grant is needed.
- `amplify/functions/ingest-webhook/webhook-secret.ts` (new): `lazyWebhookSecret(name)`. It is a
  memoized promise, and a failure is not cached. It never throws: it resolves `undefined`, which the
  adapter turns into a fail-closed 400. On failure it logs only the error class
  (`webhook-secret-unavailable`). It reaches the SSM code by **dynamic** `import("./ssm-reader")`.
- `amplify/functions/ingest-webhook/ssm-reader.ts` (new): one SigV4-signed JSON-1.1 POST to
  `ssm.<region>.amazonaws.com` (`X-Amz-Target: AmazonSSM.GetParameter`, `WithDecryption: true`). It
  uses `@smithy/signature-v4`, `@aws-sdk/credential-provider-node` and `node:crypto`. A non-200, a
  non-JSON body or a missing `Value` throws `ParameterReadError`, whose message never quotes the
  response. Checked live with the devault profile: it reads the real parameter (64 chars, value not
  printed), and a missing name gives `ParameterReadError … answered 400`.
- `amplify/functions/ingest-webhook/handler.ts`: changes are local to init and the accept call. It
  has an optional `WebhookDeps.webhookSecret`; `buildLive` installs the lazy getter, which is **not**
  part of D-346's warm-up. It passes `adapter.accept(req, { webhookSecret })`. It stays vendor-blind:
  no source name, and no SSM import at module scope.
- `src/adapters/types.ts`: `AcceptContext { webhookSecret?: () => Promise<string | undefined> }`,
  and `accept(req, ctx?)`. `src/adapters/strava/adapter.ts` passes it through.
  `src/adapters/strava/accept.ts` calls the getter on GET only. If the getter is given and resolves
  `undefined`, it passes `""`, which is "unconfigured", a 400. Passing undefined would re-trigger the
  env default. `handshake.ts` changes in comments only; the handshake logic is untouched.
- `package.json` / `package-lock.json`: `@smithy/signature-v4` and
  `@aws-sdk/credential-provider-node` are now declared direct dependencies, at the versions already
  installed and hoisted. They were transitive (DynamoDB/SQS clients), and importing an undeclared
  package is fragile. Only the root `dependencies` lines of the lockfile changed.
- Tests: `amplify/ingest-webhook-stack.test.ts` is amended on purpose (reason in its comment):
  still four actions, `ssm:GetParameters` (Amplify's, two paths) becomes `ssm:GetParameter` (ours,
  one shared path), the env has no token key, `AMPLIFY_SSM_ENV_CONFIG` is empty, and the 0093
  `rate#*` UpdateItem assertions are kept. New: `ssm-reader.test.ts` (request shape, region host,
  signed `Authorization` covering `x-amz-target` and `host`, and 7 failure shapes that fail closed
  without quoting the body) and `webhook-secret.test.ts` (POST constructs and reads nothing; GET
  reads once and caches; a read failure gives a 400 and is not cached; an empty or unconfigured
  token gives a 400; the token is in no log line). 0092's two handshake test files pass
  **unchanged**.
- `docs/08-security-privacy.md` §3 S3 row, §4.2, §4.5 and §7.2 table: "SSM via `secret()`" is now
  the lazy GET-only read.

**Decisions**
- **Hand-signed request, not `@aws-sdk/client-ssm`** (D-357, proposed). Adding client-ssm took
  the handler bundle from ~582 KB to 783 KB, against 0091's pinned 700 KB ceiling. Amplify's esbuild
  resolves the package's CJS build, so nothing tree-shakes; even its ESM build is 161 KB. All of it
  would be parsed in init on every cold start, the cost this ticket removes. The signer and the
  credential chain are already in the bundle, so the hand-signed request costs ~0 B (582,253 B
  measured). The ceiling stays.
- **The env fallback stays** (orchestrator, Q2). With no getter passed (the tests), the adapter
  reads `process.env.STRAVA_WEBHOOK_VERIFY_TOKEN` as before. That is what keeps 0092's handshake
  tests unchanged. The deployed function no longer has that key, so the fallback fails closed there.
- **The shared path only.** The token exists at `/amplify/shared/…`, plus a stale sandbox copy at
  `/amplify/lostsoles/root-sandbox-…/`. The branch path `secret()` tried first never existed. A
  sandbox now reads the shared parameter, the same as the OAuth credentials already do.
- **Failure resolves `undefined`, not a 500.** D-347 says every bad GET gets the same bare 400, and
  a missing secret fails closed. An SSM outage is "unconfigured", not a server error.

