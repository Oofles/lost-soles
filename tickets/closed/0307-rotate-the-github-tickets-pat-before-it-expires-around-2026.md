---
id: 307
slug: rotate-the-github-tickets-pat-before-it-expires-around-2026
title: Rotate the GitHub tickets PAT before it expires around 2026-11-29
type: chore
priority: med
status: closed
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-22T19:51:44Z
started: 2026-10-26T15:07:00Z
closed: 2026-10-26T16:04:33Z
---

## Description

`docs/runbooks/github-pat-rotation.md` dates the tickets PAT's expiry to roughly 2026-11-29. The SSM parameter `GITHUB_TICKETS_PAT` is still version 1. If it lapses, the capture endpoint stops committing to `tickets/inbox/`. Found by the 0115 agent's playbook dry-read, wave 18.1.

## Acceptance criteria

- [x] ~~A new fine-grained PAT is created with the runbook's scopes, and written to the SSM SecureString (version 2).~~ *Withdrawn 2026-10-26 by the operator: the premise was wrong. The token does not expire (see Resolution).*
- [x] ~~The old PAT is revoked at GitHub.~~ *Withdrawn with the rotation.*
- [x] ~~A capture POST commits to `tickets/inbox/` with the new token (smoke test), and the test capture is then declined through triage.~~ *Withdrawn with the rotation; the live token's 200 from `api.github.com/user` stands in (Operator validation).*

## Notes

Creating the PAT needs the operator at github.com; everything after that is the agent's. Do it before 2026-11-22 to leave a week's margin.

## Operator validation

Operator: create the PAT in GitHub's settings. Agent: SSM write, capture smoke test, revoke check.

D-123 trigger checked? none (no auth, sharing, export or public route changes).

## Resolution

**Closed with no rotation, because the premise was wrong.** The ticket assumed the PAT expires around
2026-11-29. That date was never read from GitHub; the runbook derived it from the 90-day policy.
On 2026-10-26 the orchestrator read the live token from SSM (version 1) and called
`api.github.com/user` with it. The call returned **200 with no `github-authentication-token-expiration`
header**, and GitHub omits that header only when a token never expires. There is no deadline, so
nothing in the capture path is at risk.

The operator chose to close it as written, without rotating. That knowingly leaves the token outside
the runbook's 90-day rule (§0). The runbook's §3 recommendation, a GitHub App instead of a PAT, is
unchanged, and so is the leak path (§2).

**Files.** `docs/runbooks/github-pat-rotation.md` §0: the "Expires" row now records **never**, how
that was established, and the operator's choice. All three criteria are withdrawn and struck through,
with the reason, rather than ticked.

## Operator validation (result)

Smoke test, 2026-10-26 (orchestrator, read only): the token was fetched from
`/amplify/shared/d14fhvl4rp79nn/GITHUB_TICKETS_PAT` with `--with-decryption` into a shell variable and
never printed. `curl -D - https://api.github.com/user` returned `HTTP/2 200` with no expiration
header. The credential is live and has no expiry. Nothing was written. The operator decided at the
wave's hand-over: close as premise wrong.
