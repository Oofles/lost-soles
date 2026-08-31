---
id: 17
slug: secrets-via-ssm-and-bundle-leak-test
title: Secrets via SSM secret() and a client-bundle leak test in CI
type: feature
priority: high
status: open
size: m
capability: 02-deploy-and-auth
depends_on: [12, 13]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Establish the secrets mechanism before there is a secret worth stealing, and add the CI check that
catches the one mistake that actually matters (`01-architecture.md` §7).

**SSM Parameter Store via Amplify's `secret()`.** Set with `npx ampx sandbox secret set <KEY>` for
the sandbox, or in the Amplify console for branch environments. Stored at
`/amplify/shared/<app-id>/<key>` or `/amplify/<app-id>/<branch>-branch-<hash>/<key>`, and
`secret('KEY')` resolves the correct one per environment automatically. **Standard parameters are
free.**

The registry to establish now (values land with their consuming capabilities):

| Key | Used by | Notes |
|---|---|---|
| `STRAVA_CLIENT_ID` | `/api/strava/callback`, `process-activity`, `token-refresh` | Semi-public — it appears in the OAuth authorize URL — but kept server-side anyway; no reason to build the habit of leaking it |
| `STRAVA_CLIENT_SECRET` | callback + token refresh | **Never leaves a Lambda.** |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | `strava-webhook` GET handshake | Compared in constant time |
| `INGEST_BEARER_TOKEN` | `/api/ingest` | Post-MVP (D-112/D-113); rotate by changing the parameter and the device config |
| `TILES_BASE_URL` | client build | **Not a secret** — environment-varying config. Use an env var, not `secret()` |

**Environment variables are NOT secrets.** Amplify renders them in plaintext into build artifacts,
readable by anyone with `get-app` access on the app. Anything sensitive uses `secret()`.

**Secrets Manager is deliberately not used** — $0.40/secret/month is real money against a $3–5 budget
(D-083), and its rotation machinery buys nothing here.

**The leak test.** A CI step greps the built `.next/static` output — and every Lambda bundle — for the
literal values of the secrets above plus the generic patterns, and **fails the build on a hit**.
Cheap, and it catches the exact failure that turns a private app into a public credential.

What is **public by design and must not be mistaken for a leak**: `amplify_outputs.json` contains the
Cognito user pool ID, app client ID, identity pool ID and AppSync endpoint. These are public
identifiers protected by pool policy and AppSync auth rules, not by obscurity. The file is gitignored
because it is *generated per-environment*, not because it is sensitive, and its presence in the
client bundle is **correct**. The leak test must not flag it.

Also codified here, from §7 "what never reaches the client": **no OAuth token of any kind is ever
sent to the browser** — the Strava code exchange happens entirely inside `/api/strava/callback` and
the browser sees only a redirect and a "connected" boolean. **The client never talks to Strava**; all
source API traffic originates from Lambda.

## Acceptance criteria

- [ ] The five keys above are documented in `docs/capabilities/02-deploy-and-auth.md` with their
      consumers and their store (SSM `secret()` vs plain env var), matching the §7 table.
- [ ] At least one real secret is set in the sandbox with `npx ampx sandbox secret set` and read at
      runtime through `secret('KEY')`, proving the mechanism end to end.
- [ ] `TILES_BASE_URL` is an environment variable, **not** a `secret()`, and a comment says why.
- [ ] No secret value appears in `amplify/` source, in `.env` files committed to the repo, or in any
      log line — verified by a grep over the repo and over a build log.
- [ ] A CI step greps the built `.next/static/**` for the literal value of every SSM-backed secret in
      the environment and **fails the build** on a hit.
- [ ] The same step greps every built Lambda bundle for the same literals, allowing values that are
      legitimately baked into server-side bundles only if the design says they belong there —
      otherwise failing.
- [ ] The step also greps for the generic patterns `AKIA[0-9A-Z]{16}`, `ghp_`, `github_pat_`,
      `-----BEGIN .* PRIVATE KEY-----` and `xox[baprs]-`.
- [ ] The check is **proven capable of failing**: temporarily reference a secret from a client
      component, confirm the build goes red and the failure message names the file and the key, then
      revert. Evidence in the capability doc.
- [ ] The check **does not** flag `amplify_outputs.json` or its contents (user pool id, app client id,
      identity pool id, AppSync endpoint) — asserted by a test, so a future contributor does not
      "fix" a false positive by deleting the check.
- [ ] The check runs both in the GitHub Actions PR gate (0013) and in the Amplify build, so a push to
      `main` cannot bypass it.
- [ ] `docs/capabilities/02-deploy-and-auth.md` states the standing rule: environment variables are
      not secrets, Amplify renders them in plaintext into build artifacts, and anything sensitive uses
      `secret()`.

## Notes

Per-user rotating credentials — Strava access and refresh tokens — do **not** live in SSM. They live
in the `LostSolesSourceAccount` DynamoDB table, created in CDK and deliberately **not** an Amplify
Data model so it is not exposed through AppSync at all and no auth rule can be misconfigured into
leaking it (`01-architecture.md` §7). That table belongs to capability `05`, not here. The split is
by **rotation frequency and ownership**: static application config in SSM, per-user rotating
credentials in DynamoDB.

This is the same class of failure as O-005 (0002): a credential ending up somewhere that is not
classified as a secret store. The `08-security-privacy.md` §7.4 standing rule applies here too —
config files hold **references** (a parameter path, an env var name), never the material.

The gitleaks scan (0004) covers *committed source*; this check covers *built output*. They are
different surfaces and both are needed — a secret can reach `.next/static` without ever being
committed, by being read from SSM into a client component.

## Operator validation

Mostly invisible infrastructure, but not entirely — and the visible part is the part that proves it.

1. On the **Android phone**, open `https://soles.devaultsecurity.com`, sign in, then open Chrome's
   **View source** / devtools via `chrome://inspect` from the laptop and search the loaded JS for the
   first six characters of the Strava client secret. Zero hits. This is the actual threat model:
   a secret in a bundle is readable by anyone who loads the page.
2. On the laptop, run `npm run build` and then
   `grep -r "<secret value>" .next/static/` by hand once. It must return nothing. Do this manually at
   least once so you have seen the check's ground truth rather than trusting a green tick.
3. In a desktop browser, open a PR that deliberately leaks a secret into a client component. The
   **Checks** tab must go red on the leak-test step, and the message must name the file and the key.
   Close the PR without merging.
4. In the Amplify console, open the latest `main` build log and confirm the leak-test step ran and
   passed there too — the PR gate alone is not sufficient, since a direct push to `main` would skip
   it.
