---
id: 319
slug: re-check-the-amplify-tree-advisories-graphql-tools-utils-zod
title: Re-check the Amplify-tree advisories (@graphql-tools/utils, zod) on the next backend-cli release
type: chore
priority: low
status: closed
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-26T16:05:00Z
closed: 2026-10-27T02:33:27Z
---

## Description

Found by 0308. The two leaf advisories behind the full tree's 37 highs, @graphql-tools/utils GHSA-7mx3 and zod GHSA-mrhx, both wait on an upstream @aws-amplify/backend-cli release (D-450). Re-run npm audit after the next release and clear whatever it fixes.

## Deferred — resumed 2026-10-27

**Reason:** Waits on an upstream @aws-amplify/backend-cli release past 1.10.0 (D-450); none since 2026-09-10.

**Re-check** — the cheap test that says the wait is over. `tickets.mjs recheck 0319`
runs it and reports the result; nothing un-defers on its own. When it exits 0, read the
output and `tickets.mjs resume 0319`.

```sh
v=$(npm view @aws-amplify/backend-cli version 2>/dev/null); if [ -n "$v" ] && [ "$v" != "1.10.0" ]; then echo "READY: backend-cli $v released (was 1.10.0)"; else echo "WAITING: backend-cli still ${v:-unknown}"; exit 1; fi
```

**Resumed 2026-10-27:** operator: accept the risk rather than wait on Amplify

## Deferred — resumed 2026-10-26

**Reason:** Waits on an upstream @aws-amplify/backend-cli release past 1.10.0 (D-450); none since 2026-09-10.

**Re-check** — the cheap test that says the wait is over. `tickets.mjs recheck 0319`
runs it and reports the result; nothing un-defers on its own. When it exits 0, read the
output and `tickets.mjs resume 0319`.

```sh
v=$(npm view @aws-amplify/backend-cli version 2>/dev/null); if [ -n "$v" ] && [ "$v" != "1.10.0" ]; then echo "READY: backend-cli $v released (was 1.10.0)"; else echo "WAITING: backend-cli still ${v:-unknown}"; fi
```

**Resumed 2026-10-26:** re-deferring: the first re-check exited 0 while still waiting

## Acceptance criteria

**Withdrawn 2026-10-26 — D-461.** Declined by the operator as an accepted risk. The three originals
are preserved verbatim in `## Resolution`.

- [x] Declined into `tickets/closed/` with a `## Resolution`; D-461 records the accepted risk and
      what still watches it; the allowlist entries' `recheck` names D-461 instead of this ticket.

## Notes

Waits on an upstream release, so this is a candidate for `tickets.mjs defer` with a re-check that compares `npm view @aws-amplify/backend-cli version` against 1.10.0.

## Operator validation

**None owed: declined, not delivered.** Smoke check on the replacement watch, run on `main` by the
orchestrator: `node scripts/check-npm-audit.mjs` exits 0, admitting exactly the two advisories, and
`npm view @aws-amplify/backend-cli version` is still 1.10.0.

## Resolution

**Declined by the operator, 2026-10-26: accept the risk and move on (D-461).**

The ticket had been deferred hours earlier, waiting on an `@aws-amplify/backend-cli` release past
1.10.0. None has shipped since 2026-09-10, and `0117`, the MVP sweep, depends on every capability-18
ticket, so this one wait held the whole capability. The operator would not hold development on an
upstream release with no date.

The two advisories are dev-time only: they sit in Amplify's CLI and codegen tree, while the runtime
tree is gated with no exceptions. Three things still watch them:
- D-459's stale-entry rule fails the first build after an upgrade clears either advisory, and forces
  its allowlist entry out.
- Dependabot alerts (D-449).
- The allowlist's severity cap fails the build if either advisory is re-rated above high.

Files touched: `docs/decisions/DECISIONS.md` (D-461), `scripts/npm-audit-allowlist.json` (both
`recheck` strings) and `scripts/check-npm-audit.test.mjs` (its pin now requires D-461, not 0319),
`docs/08-security-privacy.md` §7.5's as-built note.

Original criteria, verbatim:

> - [ ] `npm audit` is re-run after the next `@aws-amplify/backend-cli` release. Every advisory that the
>       release fixes is cleared within a major (D-434), and the 0308 section of `18-mvp-hardening.md`
>       is updated with the new counts.
> - [ ] D-162 holds: `npm install --no-save` from a clean clone leaves `package-lock.json` byte-identical.
> - [ ] The full local gate and the Amplify build are green.
