---
id: 307
slug: rotate-the-github-tickets-pat-before-it-expires-around-2026
title: Rotate the GitHub tickets PAT before it expires around 2026-11-29
type: chore
priority: med
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-22T19:51:44Z
started: 2026-10-26T15:07:00Z
---

## Description

`docs/runbooks/github-pat-rotation.md` dates the tickets PAT's expiry to roughly 2026-11-29. The SSM parameter `GITHUB_TICKETS_PAT` is still version 1. If it lapses, the capture endpoint stops committing to `tickets/inbox/`. Found by the 0115 agent's playbook dry-read, wave 18.1.

## Acceptance criteria

- [ ] A new fine-grained PAT is created with the runbook's scopes, and written to the SSM SecureString (version 2).
- [ ] The old PAT is revoked at GitHub.
- [ ] A capture POST commits to `tickets/inbox/` with the new token (smoke test), and the test capture is then declined through triage.

## Notes

Creating the PAT needs the operator at github.com; everything after that is the agent's. Do it before 2026-11-22 to leave a week's margin.

## Operator validation

Operator: create the PAT in GitHub's settings. Agent: SSM write, capture smoke test, revoke check.

D-123 trigger checked? none (no auth, sharing, export or public route changes).
