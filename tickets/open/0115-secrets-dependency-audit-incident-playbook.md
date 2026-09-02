---
id: 115
slug: secrets-dependency-audit-incident-playbook
title: Secrets and dependency audit; incident playbook dry-read
type: chore
priority: high
status: open
size: m
capability: 18-mvp-hardening
depends_on: [6, 17, 96]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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

- [ ] The §7 forbidden-list grep passes against `.next/static` and is wired into CI as a build
      failure, not a report.
- [ ] gitleaks passes over the **full git history** in CI; the command and its scope are recorded.
- [ ] The O-005 key is rotated (new value in SSM, old value revoked at the provider) and its file
      is in `.gitignore`; both are verified independently.
- [ ] Every secret is a `SecureString` in SSM; a test asserts no plaintext secret in any Lambda
      environment variable or CDK output.
- [ ] Logger redaction masks each secret prefix; a test logs a fake token of each shape and
      asserts the CloudWatch line is masked.
- [ ] Cognito self-signup and unauthenticated identities are both **OFF** on the deployed pool,
      verified by an API call against the live pool and recorded in the capability doc.
- [ ] `npm audit` (or equivalent) runs in CI and fails on high/critical; current advisory count is
      recorded.
- [ ] A poisoned message is deliberately sent, lands in the DLQ, and produces a visible signal in
      the place the operator actually checks — with a screenshot of that signal.
- [ ] A $10/month billing alarm exists and has been test-fired; one month of real billing is
      recorded against the D-083 target.
- [ ] The §8 incident playbook has been dry-read end to end; every step's named resource exists
      and is reachable, and any that were not are fixed and noted.

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
result in `docs/capabilities/18-mvp-hardening.md`. Then, on the Android phone specifically:
trigger the poisoned-message test and confirm the notification actually arrives on the phone
(this is the whole point — the operator's phone is where incidents are noticed); and open the
deployed app, view source and search for `ghp_`, `client_secret`, and the Strava client secret
value by hand, in the mobile browser, so the grep's result is confirmed by a human on the real
artifact.
