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
started: 2026-08-31T19:57:24Z
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

- [x] The five keys above are documented in `docs/capabilities/02-deploy-and-auth.md` with their
      consumers and their store (SSM `secret()` vs plain env var), matching the §7 table.
- [x] At least one real secret is set in the sandbox with `npx ampx sandbox secret set` and read at
      runtime through `secret('KEY')`, proving the mechanism end to end.
- [x] `TILES_BASE_URL` is an environment variable, **not** a `secret()`, and a comment says why.
- [x] No secret value appears in `amplify/` source, in `.env` files committed to the repo, or in any
      log line — verified by a grep over the repo and over a build log.
- [x] A CI step greps the built `.next/static/**` for the literal value of every SSM-backed secret in
      the environment and **fails the build** on a hit.
      *AMENDED:* values under 12 characters are skipped, and every skip is printed with its key name
      and reason. `STRAVA_CLIENT_ID` is a six-digit number; scanning for it matches minified chunk
      names and integer constants many times per bundle, and a check that cries wolf is a check
      people learn to ignore. §7 already records the client id as semi-public by design. See the
      capability doc, "Two amendments to the ticket".
- [x] The same step greps every built Lambda bundle for the same literals, allowing values that are
      legitimately baked into server-side bundles only if the design says they belong there —
      otherwise failing.
- [x] The step also greps for the generic patterns `AKIA[0-9A-Z]{16}`, `ghp_`, `github_pat_`,
      `-----BEGIN .* PRIVATE KEY-----` and `xox[baprs]-`.
- [x] The check is **proven capable of failing**: temporarily reference a secret from a client
      component, confirm the build goes red and the failure message names the file and the key, then
      revert. Evidence in the capability doc.
      *AMENDED in form:* done as a local build under real SSM credentials rather than as a pull
      request, because D-150 makes `main` the only branch and there is no PR flow to go red in. The
      identical code path was exercised; `--self-test` supplies the standing coverage a one-off PR
      would not have. Full transcript in the capability doc.
- [x] The check **does not** flag `amplify_outputs.json` or its contents (user pool id, app client id,
      identity pool id, AppSync endpoint) — asserted by a test, so a future contributor does not
      "fix" a false positive by deleting the check.
- [x] The check runs both in the GitHub Actions PR gate (0013) and in the Amplify build, so a push to
      `main` cannot bypass it.
- [x] `docs/capabilities/02-deploy-and-auth.md` states the standing rule: environment variables are
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

## Resolution

Two mechanisms, and two design collisions found by building them.

**Files touched**

- `scripts/check-bundle-leak.mjs` — new. Plain node, no dependencies, no ripgrep, so it runs in both
  the GitHub gate and the Amplify container (D-163). Two zones: `CLIENT` (`.next/static/**`, zero
  literals, no allowlist) and `SERVER` (`.next/server/**` and `.amplify/artifacts/cdk.out/**`
  including `.zip` bundles opened with `unzip`, also zero, `SERVER_ALLOWLIST` empty by design).
  Resolves literals from SSM → `process.env` → `.env.local`, in that order. **It never prints a
  secret value** — findings carry the key, the file and the byte offset, and the excerpt shows
  `<KEY>` where the value sat.
- `scripts/check-bundle-leak.test.mjs` — new. Criterion 9's assertion that `amplify_outputs.json`'s
  public identifiers are not flagged, plus the reverse cases. Written as a test rather than left to
  inspection because the failure mode is social: someone sees the check go red on a pool id,
  concludes it is noisy, deletes the check.
- `vitest.config.ts` — `**/*.test.mjs` added to `include`. The check scripts are plain node by
  necessity, so their tests cannot be `.ts`.
- `amplify/functions/secret-smoke-test/{resource,handler}.ts` — new. The only way to prove `secret()`
  works, since it resolves *only* into a Lambda environment. Returns the value's length and a
  12-character SHA-256 prefix, never the value. Reads `process.env`, not `$amplify/env/...`, because
  that typed accessor is generated into gitignored `.amplify/` and would break a fresh clone exactly
  as `amplify_outputs.json` did in 0014. **Delete when 0094 ships.**
- `amplify/backend.ts` — wires it in.
- `scripts/check-boundaries.mjs` — D-166 narrowing plus five new self-test cases (21 total).
- `.github/workflows/gate.yml` — `npm run build`, then the self-test, then the pattern scan.
- `amplify.yml` — the same plus `--require-literals`, after `npm run build` in the frontend phase so
  the backend phase's `cdk.out` is present in the same container.
- `.env.example` — `NEXT_PUBLIC_TILES_BASE_URL` with the comment on why it is not a `secret()`.
- `docs/capabilities/02-deploy-and-auth.md` — the registry, the standing rule, both amendments, the
  D-100 collision, and the verbatim red-build transcript.
- `docs/decisions/DECISIONS.md` — **D-166**.

**What went wrong, in order**

1. **The check went red on its first real run — correctly, and on the wrong thing.** Eight findings
   inside `asset.98f62bef….zip!awscli/botocore/data/iam/…/examples-1.json`: the AWS CLI Lambda layer
   CDK vendors in for the storage construct, carrying 4,300 files of AWS's own API documentation.
   All three AKIA values ended in `EXAMPLE`; the private-key hit was a header followed by the literal
   text `<a very long private key string>`. The one-line fix was to allowlist that path — and that
   would have switched the pattern scan off inside the largest third-party blob in the build, which
   is where a supply-chain problem would actually sit. Narrowed both patterns by shape instead. The
   scan stays live in every zone.
2. **`STRAVA_CLIENT_ID` is six digits.** Scanning for it as a literal matches minified chunk names
   and integer constants throughout a bundle. Added a 12-character floor with the skip reported by
   name — visible in the clean run's real output, not just asserted in prose.
3. **The first line to reference the §7 registry failed the D-100 gate.** `strava[A-Za-z0-9_]`
   matches `STRAVA_`. The gate, as written, made the secret registry unreferenceable from anywhere
   in the repo — including from the `defineFunction` block that is its correct home, which capability
   05 needs. Raised rather than worked around, per D-152; settled as **D-166**. Second narrowing of
   that tier in two tickets, both false positives on legitimate code, both fixed by making the rule
   say what it means rather than exempting a path.
4. **Importing the script for its test ran the whole check as a side effect.** Guarded the CLI behind
   an `isMain` check.
5. **The sandbox deploy failed on the auth stack** — its Cognito pool predates 0014 and cannot be
   updated in place, leaving the sandbox `UPDATE_FAILED`. Unrelated to this work; surfaced because
   adding any resource forces a full stack update. `ampx` offered to recreate the sandbox, deleting
   user data; **declined** — not something to do inside an unrelated ticket without asking. Filed as
   **0131**. The function stack itself completed, so criterion 2 was still proven. `main` is
   unaffected: all four of its stacks are `UPDATE_COMPLETE`.

6. **gitleaks blocked the commit — on this check's own test fixtures.** Five findings: the synthetic
   AKIA, `ghp_`, `xoxb-`, private-key block and 40-hex client secret planted in the self-test. Every
   one was a **true** positive for gitleaks, which scans committed *source*, and the repo is public
   (D-165) with GitHub push protection also watching. Resolved by assembling the fixture values at
   runtime from parts, with the reasoning written in place — not by an inline `gitleaks:allow`, which
   would have been the lazier fix and would still have left push protection to argue with. The
   fixtures lose nothing: this check scans *built output*, where the assembled string is
   byte-identical. Three scanners, three surfaces, no layer weakened to accommodate another. A neat
   accident: the older detector proved the newer one's fixtures are realistic.

**Decisions and their rationale**

- **Set the Strava client id and secret; did not touch the access/refresh tokens.** The operator had
  all four to hand. The first two are permanent *application* credentials and belong in SSM; the
  latter two are per-user credentials that rotate on every refresh and belong in the
  `LostSolesSourceAccount` DynamoDB table per §7 — a different store, owned by tickets 0032/0033/0094,
  all open. The split is by rotation frequency and ownership, and honouring it here is the point.
- **The operator set every secret themselves**, via `ampx sandbox secret set`, which prompts and has
  no `--value` flag. The values never entered the agent transcript, a shell history, or a file.
- **The GitHub gate holds no AWS credentials.** An OIDC role there would put SSM read access in a
  second place to buy a duplicate of a check the deploy path already runs under real credentials.
  Patterns and the self-test run there; the literal scan is the Amplify build's, with
  `--require-literals` so a broken SSM read fails rather than passes quietly. D-163's alarm/lock
  split, applied.
- **`npm run build` added to the gate.** Required — the check needs `.next/static` to exist. The side
  benefit is that a Next build error now surfaces before the deploy rather than at it.
- **`NEXT_PUBLIC_TILES_BASE_URL`, not §7's `TILES_BASE_URL`.** Next only inlines a variable into the
  client bundle with that prefix, and the browser is the consumer. The prefix is Next's own explicit
  opt-in for "this value will be public", which is the property §7 asserts about the key anyway.

## Operator validation

Performed by the agent on the laptop (WSL2, Ubuntu), 2026-08-31, against the real AWS account:

- **`secret()` resolves end to end.** The deployed `secret-smoke-test` Lambda returned
  `{"key":"STRAVA_WEBHOOK_VERIFY_TOKEN","resolved":true,"length":32,"sha256Prefix":"e5a6d6a0cde8"}`;
  the same two values computed locally from the SSM parameter match exactly. Neither end printed the
  value.
- **The check goes red on a real leak.** `NEXT_PUBLIC_LEAK_PROOF` set to the real verify token,
  referenced from a temporary client component: two findings, `CLIENT` naming
  `.next/static/chunks/app/leak-proof/page-ace43439631ddcc9.js` and the key, exit code 1, value
  masked as `<STRAVA_WEBHOOK_VERIFY_TOKEN>`. Component deleted, `.next/` removed, rebuilt, green.
- **The check is green on the real tree**, with `STRAVA_CLIENT_ID` skipped by name.
- **No secret in source or in a build log.** Every set value searched for across all 236 git-tracked
  files and the full `npm run build` log: zero hits.
- **Every gate step passes locally**, including all three self-tests.

**★ Still requires the operator, on a device ★**

1. **Android phone, Chrome, `https://soles.devaultsecurity.com`.** Sign in, then from the laptop open
   `chrome://inspect` → devtools → Network/Sources, and search the loaded JS for the first six
   characters of the Strava **client secret**. Expect zero hits. This is the actual threat model: a
   secret in a bundle is readable by anyone who loads the page. The agent verified this against the
   local build, not against what CloudFront is serving.
2. **Amplify console, desktop browser** — open the latest `main` build log and confirm both
   `check-bundle-leak.mjs` steps ran and passed there. This is the criterion the agent cannot check
   before the push, and it is the one that matters: the PR gate is an alarm, the Amplify build is the
   lock (D-163).
3. **Set `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` and `STRAVA_WEBHOOK_VERIFY_TOKEN` in the `main`
   branch environment**, in the Amplify console under Hosting → Secrets. Only the *sandbox* secrets
   were set in this ticket; `ampx` has no branch-secret command. Until this is done the Amplify
   build's `--require-literals` will fail closed, which is the intended behaviour and will be visible
   as a red build.
4. **Confirm the Amplify build role can read SSM.** If step 3 is done and the build still fails on
   "not one secret value could be resolved", the role needs `ssm:GetParametersByPath` on
   `/amplify/*` — the same class of gap `check-auth-posture.mjs` hit in 0014, recorded in the
   capability doc.
