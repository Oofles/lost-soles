---
id: 306
slug: decide-dependabot-for-npm-under-the-no-pr-trunk-model
title: Decide Dependabot for npm under the no-PR trunk model
type: chore
priority: med
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-22T19:51:44Z
started: 2026-10-26T13:42:13Z
---

## Description

`08-security-privacy.md` §7.5 calls for Dependabot. `dependabot_security_updates` is disabled on `Oofles/lost-soles` and there is no `.github/dependabot.yml`. Dependabot's PRs clash with D-150's no-PR trunk model, so this needs a decision rather than a switch-flip. Found by the 0115 agent, wave 18.1.

## Acceptance criteria

- [ ] A decision is recorded: enable Dependabot (alerts only, or PRs), or decline it with §7.5 amended.
- [ ] Whatever is decided is applied live and verified by API read.

## Notes

The runtime tree is already gated by `npm audit --omit=dev --audit-level=high` (D-434), so alerts-only may be enough.

## Operator validation

Smoke test: `gh api repos/Oofles/lost-soles` `security_and_analysis` read matches the decision.

D-123 trigger checked? none (no auth, sharing, export or public route changes).
