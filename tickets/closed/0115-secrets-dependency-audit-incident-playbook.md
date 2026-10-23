---
id: 115
slug: secrets-dependency-audit-incident-playbook
title: Secrets and dependency audit; incident playbook dry-read
type: chore
priority: high
status: closed
size: m
capability: 18-mvp-hardening
depends_on: [6, 17, 96]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-22T05:00:54Z
closed: 2026-10-23T02:19:23Z
---

## Description

`08-security-privacy.md` §3, §7.5, §8, closing the §9.4 operational boxes of the MVP definition of
done.

**Secrets.** The forbidden-list grep runs against the built client bundle (`.next/static`) and
finds nothing: no Strava client secret, no GitHub PAT (`ghp_`, `github_pat_`), no webhook signing
secret, no AWS key material. Every credential lives in SSM Parameter Store as a `SecureString`,
fetched at cold start and held in memory for the life of the execution environment; no GitHub
credential ever reaches the browser and there is no client-side GitHub SDK. Loggers carry
redaction rules for each secret prefix, and a deliberately-logged token is masked in CloudWatch.

**History.** gitleaks passes on the **full history**, not just the tip. **The O-005 key is rotated
and its file is gitignored** — a key that was ever committed is a key that is compromised, and the
gitignore is the second half of the fix, not the whole of it.

**Cognito.** Self-signup is **OFF** and unauthenticated identities are **OFF** (§5.1). Both are
asserted against the deployed pool, not against the CDK source, because the deployed value is what
an attacker meets.

**Dependencies.** A lockfile audit runs in CI and fails on high/critical advisories. Runtime
third-party origins are zero (0113). The dependency surface is small on purpose; record the count
so growth is visible.

**Billing and DLQ.** A billing alarm exists at $10/month, and one month of real billing is at or
under the D-083 target of a few dollars. A poisoned message lands in the DLQ and is visible
somewhere a human actually looks.

**Incident playbook dry-read.** Read §8 out loud, start to finish, against the live system, and
at each step confirm the named resource, console page, or command actually exists and the operator
can reach it. A playbook whose first step is "open the X dashboard" and there is no X dashboard is
worse than none: it is a plan that fails at the worst moment. Fix what the dry-read finds, in this
ticket.

## Acceptance criteria

- [x] The §7 forbidden-list grep passes against `.next/static` and is wired into CI as a build
      failure, not a report. *(Since `0017`: `check-bundle-leak.mjs`, patterns in the gate, SSM
      literals under `--require-literals` in `amplify.yml`. Re-run green here.)*
- [x] gitleaks passes over the **full git history** in CI; the command and its scope are recorded.
      *(It did not before: `gitleaks-action@v2` scans only the pushed range on a push event.
      `scripts/check-history-secrets.mjs` records both in its header: `gitleaks detect --log-opts=--all`,
      every ref, pinned 8.30.1 by sha256, and a shallow clone is refused. It runs in
      `secret-scan.yml` and `amplify.yml`. 807 commits, no leaks.)*
- [x] ~~The O-005 key is rotated (new value in SSM, old value revoked at the provider) and its file
      is in `.gitignore`; both are verified independently.~~ **Amended:** the O-005 key was an IAM
      access key for `cli-user`, so its replacement lives in `~/.aws/credentials` (profile `devault`),
      not SSM. Ticket `0002` rotated it and the orchestrator said not to rotate again. Verified
      independently, read-only: `cli-user` has one `Active` key, created `2026-08-31T01:50Z`, and the
      old key is gone (D-168). `Oofles/devaultsecurity`'s `.gitignore` carries `.claude/` and
      `*.local.json`, and its tree has 0 paths under `.claude/`.
- [x] Every secret is a `SecureString` in SSM; a test asserts no plaintext secret in any Lambda
      environment variable or CDK output. *(4 of 4 `SecureString`. `scripts/check-secret-storage.mjs`
      reads the deployed account on every deploy: SSM types, every Lambda env var in the branch's
      18 stacks, every stack output, and the Amplify app variables. Its self-test runs in the gate.)*
- [x] Logger redaction masks each secret prefix; a test logs a fake token of each shape and
      asserts the CloudWatch line is masked. *(`lib/log.test.ts`: 11 shapes × 3 levels, plus the
      private-key header, asserted at the console sink, which is the line the Lambda and SSR runtimes
      ship to CloudWatch. Live: 23,197 events across all 15 log groups, 0 raw credential shapes.)*
- [x] Cognito self-signup and unauthenticated identities are both **OFF** on the deployed pool,
      verified by an API call against the live pool and recorded in the capability doc.
- [x] `npm audit` (or equivalent) runs in CI and fails on high/critical; current advisory count is
      recorded. **Amended (operator, D-152 answer A):** the gate is on the RUNTIME tree,
      `npm audit --omit=dev --audit-level=high`, in `gate.yml` and `amplify.yml`. Before: full tree
      60 (6 critical, 49 high), prod tree 4 (3 high). The 3 prod highs were fixed here with a patch
      bump of `next` (15.5.24 → 15.5.28) plus `overrides.next.postcss`. After: full tree 56, all
      in dev; prod tree 0. The dev tree is a follow-up ticket.
- [x] A poisoned message is deliberately sent, lands in the DLQ, and produces a visible signal in
      the place the operator actually checks ~~— with a screenshot of that signal~~. **Amended
      (D-229, D-185):** that place is the operator's **email inbox** (SNS email,
      `amazingbrandon@gmail.com`, confirmed). It is read on the desktop, not the phone. The evidence
      is the alarm's action history plus the email itself. The test is a write, so it is the
      orchestrator's post-deploy smoke; tick this after it runs.
      — verified 2026-10-22: operator saw the email `ALARM: "Lost Soles — an activity failed to import"` in their inbox.
- [x] ~~A $10/month billing alarm exists and has been test-fired;~~ **Superseded by D-361:** AWS cost
      alerting is not this project's. `0289` removed `0093`'s `CfnBudget`, and `describe-budgets`
      returns none. One month of real billing is recorded against the D-083 target. September
      2026 runtime was about $1.1, which meets D-083. **Per the operator (D-433), D-083 is runtime
      only.** Build minutes (2,016 in September) are outside it. The skip-token work
      (`0214`, `0268`) and D-361 cover them.
- [x] The §8 incident playbook has been dry-read end to end; every step's named resource exists
      and is reachable, and any that were not are fixed and noted. *(8 findings, all fixed in
      `08` §8, plus a §3.1 log-retention finding that needs code: a proposed ticket.)*

## Notes

The DLQ criterion is deliberately "visible somewhere a human looks" rather than "alarm configured".
An alarm nobody receives is the same as no alarm; name the actual destination (email, phone
notification) and test that it arrives on the operator's phone.

The dry-read is the cheapest step here and the most likely to be skipped because it produces no
artifact. Its artifact is the list of things it found wrong; if that list is empty on the first
read, that is suspicious rather than reassuring — check that the playbook actually names concrete
resources rather than categories.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

On the laptop with the AWS console and the GitHub repo open, work the checklist and record each
result in `docs/capabilities/18-mvp-hardening.md`. Then:
trigger the poisoned-message test and confirm the notification actually arrives on the phone
(this is the whole point — the operator's phone is where incidents are noticed); and open the
deployed app, view source and search for `ghp_`, `client_secret`, and the Strava client secret
value by hand, in the desktop browser, so the grep's result is confirmed by a human on the real
artifact.

**DLQ smoke test, 2026-10-22 (orchestrator, against Amplify job 426's deploy):**

- 20:07:24Z: message `d2e36d72-…` sent to `ActivityIngestQueue`, with a non-JSON body.
- 20:56:30Z: the message is in the DLQ, after `ApproximateReceiveCount` 4.
- 20:58:18Z: alarm *"Lost Soles — an activity failed to import"* goes to ALARM, and its history shows *"Successfully executed action …IngestAlarms6E24538D…"* (SNS).
- 20:58:32Z: the test message is deleted, and the DLQ is back to 0.
- **Operator, 2026-10-22:** the alarm email arrived in the inbox. Criterion 8 ticked.

## Resolution

**Open at hand-off: one post-deploy write (the DLQ test).** The npm audit question was put to the
operator under D-152 and answered (A). Everything else is built, verified read-only against
the live account, and recorded in `docs/capabilities/18-mvp-hardening.md` § *0115*.

### Files touched

| File | What |
|---|---|
| `scripts/check-history-secrets.mjs` | **New.** gitleaks over every ref (`detect --log-opts=--all --redact`). Pinned 8.30.1, sha256-checked `--install`, liveness check, refuses a shallow clone (`--unshallow` retries over HTTPS because Amplify drops its SSH credentials). The self-test plants a secret, deletes it in the next commit, and requires the scan to still find it, and requires a shallow clone to be refused |
| `scripts/check-secret-storage.mjs` | **New.** Reads the deployed account. Every registry key in SSM must be a `SecureString`. No Lambda env var, stack output or Amplify app variable may carry a registry name (except `secret()`'s runtime placeholder), a secret value, or a credential shape. Reuses `check-bundle-leak.mjs`'s registry, literal resolution and `scanText`. Fails closed (D-176) |
| `.github/workflows/secret-scan.yml` | `gitleaks-action@v2` replaced by the script: self-test, then the full scan |
| `.github/workflows/gate.yml` | `check-secret-storage.mjs --self-test` (the gate holds no AWS credentials, per the `0017` precedent). `npm audit --omit=dev --audit-level=high` after the lockfile-unchanged step |
| `amplify.yml` | Backend phase: secret-storage self-test plus a live `--require-literals` run after `check-auth-posture`. Frontend build: history-scan self-test, a full scan with `--install --unshallow`, then the same `npm audit` gate |
| `package.json`, `package-lock.json` | `next` ^15.5.24 → ^15.5.28 (`sharp` 0.35.5). `overrides.next.postcss: ^8.5.31` (`source-map-js` 1.2.2), because `next` 15.5.28 still pins `postcss` 8.4.31 exactly. 40 lock entries change, all under `next`/`sharp`/`postcss`, plus `nanoid`. The lock came from a real `npm install` in a clean copy; `--package-lock-only` also added entries for the D-162 bundled trees and was discarded |
| `lib/log.test.ts` | Every 08 §3.1 shape through `log.info/warn/error`, asserted at the console sink |
| `docs/08-security-privacy.md` | §8: a facts table, plus the 8 dry-read fixes. §3 S2 rotation cell. §3.1 retention finding note. §7.3 layer 2 as built |
| `docs/capabilities/18-mvp-hardening.md` | New `0115` section: the checklist results and the dry-read findings |

### Decisions made, and why

- **A script, not `gitleaks-action`.** On `push`, the action scans `before^..after`, whatever
  `fetch-depth` is, so the "full history" comment in `secret-scan.yml` was false. A script also
  lets one pinned version and checksum serve both CI surfaces (D-163).
- **Live secret-storage check in the backend phase.** It needs credentials and a fresh deploy, as
  `check-auth-posture` does. It uses only grants the build role already holds through
  `AmplifyBackendDeployFullAccess`: `cloudformation:ListStacks`, `ListStackResources` and
  `DescribeStacks` on `amplify-*`; `lambda:GetFunction` on `amplify-*`; `ssm:DescribeParameters`;
  `amplify:ListApps`; and the `/amplify/*` SSM read. **This has not been exercised under the
  build role**, only under `devault`. If the first deploy fails it, the error names the call.
- **`secret()`'s placeholder is allowed under a registry name.** `secret-smoke-test` carries
  `STRAVA_WEBHOOK_VERIFY_TOKEN=<value will be resolved during runtime>`. That is not plaintext
  storage, and `0290` deletes the function, so this ticket leaves it.
- **The DLQ signal is the email inbox, read on the desktop** (D-229, D-185). No phone.
- **The audit gate covers the runtime tree, high and critical only** (the operator's answer A to
  the D-152 question). A patch bump of `next` was preferred over overrides. One override was still
  needed, because `next` 15.x pins `postcss` exactly. No `next` major was taken.
- **D-083 covers runtime only** (operator, D-433). Build minutes are governed by the
  skip-token work and D-361.
- **Log retention not fixed here.** Fixing it is a CDK change on 14 functions plus an
  Amplify-owned SSR group. That widens scope, so it is a proposed ticket.

### Verification (this worktree)

All `amplify.yml` guards pass, plus the two new scripts. `npm run typecheck`, `npm run lint` and
`npm run build` pass. `npx vitest run`: 255 files, 4,352 passed, 1 skipped (re-run on `next`
15.5.28). `npm audit --omit=dev --audit-level=high`: 0. `npm install --no-save --prefer-offline`
from a clean copy leaves `package-lock.json` byte-identical (`cmp`). Live and read-only:
`check-auth-posture` passes on `us-east-1_3lreDA1d1` (branch `main`).
`check-secret-storage --require-literals` passes: 18 stacks, 14 Lambdas, 37 env vars, 87
outputs. The history scan is clean over 807 commits. The CloudWatch scan found 0 raw shapes in
23,197 events.

`docs/INDEX.md` is not regenerated: that is the orchestrator's (WAVES §3), and the docs-index check
fails until it is.
