---
id: 309
slug: widen-the-invariant-sweep-s-app-roots-to-amplify-components
title: Widen the invariant sweep's APP_ROOTS to amplify, components and tools
type: chore
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-22T19:51:44Z
started: 2026-10-26T20:04:43Z
---

## Description

The audit's invariant-citation row scans `src|app|lib|scripts` only. The structural tests that cite I-1, I-2, I-3, I-20, I-28 and I-30 under `amplify/`, `components/` and `tools/` run in `npm test` but are invisible to the audit. Every invariant also has a citing test under a scanned root, so the row is complete today (0116), but a citation that exists only outside those roots would read as lost. The 0116 agent tried the one-line edit in `tickets.mjs`; the sandbox refused it as self-modification of `.claude/`.

## Acceptance criteria

- [x] `APP_ROOTS` includes `amplify`, `components` and `tools`.
- [x] `tickets.mjs audit 18` still reports all 30 cited and complete.
- [x] A tickets test covers a citation found only under one of the new roots.

## Notes

An orchestrator-session change, since agents cannot edit `.claude/`.

## Operator validation

**None owed: tooling only.** Smoke test, run by the orchestrator on the real repo after the change:
`tickets.mjs audit 18-mvp-hardening --json` reports `invariant-sweep pass — all 30 invariants cited
by a test name, and the set is declared complete`, and `vigil-test pass`. Nothing deploys.

## Resolution

Built by the orchestrator in the main session, because agents cannot edit `.claude/` (the `0116`
agent was refused the same one-line edit).

- `.claude/skills/tickets/scripts/tickets.mjs`: `APP_ROOTS` gains `amplify`, `components` and
  `tools`, with the reason added to the existing doc comment. `.claude/` stays excluded for the
  0133 fixture reason the comment already gives. `vigilTests()` shares `testFiles()`, so the vigil
  marker search widens with it, which is correct for the same reason.
- `.claude/skills/tickets/scripts/tickets.test.mjs`: a new test plants an `I-1` test-name citation
  under each new root alone (`amplify/functions/x`, `components`, `tools`) and asserts the sweep
  passes with 1/1 cited. The existing "outside the app roots does not activate" test still passes,
  so `.claude/` stays out.

Verified: `node --test` on the tickets suite, 205 pass, 0 fail. `audit 18` reports all 30 cited and
complete. One snag: `audit 18` with the bare number printed only the capability list, while
`waves 18` accepts the number. I ran it with the full slug. That inconsistency is minor, and not
filed.
