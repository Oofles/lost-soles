---
id: 306
slug: decide-dependabot-for-npm-under-the-no-pr-trunk-model
title: Decide Dependabot for npm under the no-PR trunk model
type: chore
priority: med
status: closed
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-22T19:51:44Z
started: 2026-10-26T13:42:13Z
closed: 2026-10-26T14:37:33Z
---

## Description

`08-security-privacy.md` §7.5 calls for Dependabot. `dependabot_security_updates` is disabled on `Oofles/lost-soles` and there is no `.github/dependabot.yml`. Dependabot's PRs clash with D-150's no-PR trunk model, so this needs a decision rather than a switch-flip. Found by the 0115 agent, wave 18.1.

## Acceptance criteria

- [x] A decision is recorded: enable Dependabot (alerts only, or PRs), or decline it with §7.5 amended.
  *(Operator chose alerts only, option A. The decision text is proposed as D-449 for the
  orchestrator to allocate; 08 §7.5 and the §9 out-of-scope row are amended.)*
- [x] Whatever is decided is applied live and verified by API read.
  *(Left open for the orchestrator. Wave agents may not change GitHub settings, so the
  orchestrator runs `PUT /vulnerability-alerts` after the merge and verifies it by API read.)*

## Notes

The runtime tree is already gated by `npm audit --omit=dev --audit-level=high` (D-434), so alerts-only may be enough.

## Resolution

**Decision (operator, option A): Dependabot alerts only.** Vulnerability alerts on. Security-update
PRs and version-update PRs off. No `.github/dependabot.yml`. Proposed as D-449; the orchestrator
allocates the id and swaps the `D-449` placeholders in `08`.

**Why.** Before this ticket the repo (public) had alerts off (`/vulnerability-alerts` returned
404), `dependabot_security_updates` disabled, `automated-security-fixes` `enabled:false`, and no
`dependabot.yml`. The real gap was finding out about a new runtime advisory between pushes, because
the D-434 `npm audit --omit=dev --audit-level=high` gate only runs when a build runs. Alerts close
that gap for free. Bot PRs would put commits on `main` with no ticket and no `NNNN:` message,
breaking D-150's ticket-and-code atomic unit, and squash-merging them in the GitHub UI would skip
the local gitleaks hook. Version-update PRs (the original §7.5 plan) would add a weekly PR stream
against a single-maintainer trunk. A fix for an alert goes through a ticket like any other change:
patch/minor bump first, override second (D-434).

Options considered and rejected: B (alerts + security-update PRs: needs a D-150 carve-out or
becomes A with noise), C (§7.5 as written: weekly grouped version updates, largest D-150 clash),
D (decline: leaves the between-pushes gap for no saving).

Other facts checked: Amplify app `d14fhvl4rp79nn` has auto-branch creation and branch auto-build
off, so any `dependabot/*` branch would never have deployed anyway. Alerts will at first include
the ~56 dev-tree advisories, which ticket 0308 clears.

**Files touched.**
- `docs/08-security-privacy.md`: §7.5 Dependabot bullet gains an "as decided (D-449)" note;
  the §9 out-of-scope row "Automated dependency patching SLAs…" now says alerts, not weekly PRs.
- This ticket.

**Not done here (orchestrator):** `gh api -X PUT repos/Oofles/lost-soles/vulnerability-alerts`
and the verification read; allocate D-449 in `DECISIONS.md`; regenerate `docs/INDEX.md`
(08's line ranges shift by 5 after §7.5).

## Operator validation

Smoke test: `gh api repos/Oofles/lost-soles` `security_and_analysis` read matches the decision.

**Result, 2026-10-26 (orchestrator):** ran `gh api -X PUT repos/Oofles/lost-soles/vulnerability-alerts`.
Then `vulnerability-alerts -i` returns `HTTP/2.0 204`, `security_and_analysis.dependabot_security_updates.status`
is `disabled`, `automated-security-fixes` is `{"enabled":false}`, and `.github/dependabot.yml` is 404.
Alerts only, as D-449 decides. No perceptual check.

D-123 trigger checked? none (no auth, sharing, export or public route changes).
